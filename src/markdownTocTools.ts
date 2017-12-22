import * as vscode from 'vscode';

import { MarkdownHeaderProvider } from './markdownHeaderProvider'

const REGEXP_TOC_START = /\s*<!--(.*)TOC(.*)-->/gi;
const REGEXP_TOC_STOP = /\s*<!--(.*)\/TOC(.*)-->/gi;
const REGEXP_TOC_CONFIG = /\w+[:=][\w.]+/gi;
const REGEXP_TOC_CONFIG_ITEM = /(\w+)[:=]([\w.]+)/;
const REGEXP_MARKDOWN_ANCHOR = /^<a id="markdown-.+" name=".+"><\/a\>/;
const REGEXP_HEADER = /^(\#{1,6})\s*([.0-9]*)\s*(.+)/;
const REGEXP_CODE_BLOCK1 = /^```/;
const REGEXP_CODE_BLOCK2 = /^~~~/;
const REGEXP_ANCHOR = /\[.+\]\(#(.+)\)/
const REGEXP_IGNORE_TITLE = /<!-- TOC ignore:true -->/

const DEPTH_FROM = "depthFrom";
const DEPTH_TO = "depthTo";
const INSERT_ANCHOR = "insertAnchor";
const WITH_LINKS = "withLinks";
const ORDERED_LIST = "orderedList";
const UPDATE_ON_SAVE = "updateOnSave";
const ANCHOR_MODE = "anchorMode";

const LOWER_DEPTH_FROM = DEPTH_FROM.toLocaleLowerCase();
const LOWER_DEPTH_TO = DEPTH_TO.toLocaleLowerCase();
const LOWER_INSERT_ANCHOR = INSERT_ANCHOR.toLocaleLowerCase();
const LOWER_WITH_LINKS = WITH_LINKS.toLocaleLowerCase();
const LOWER_ORDERED_LIST = ORDERED_LIST.toLocaleLowerCase();
const LOWER_UPDATE_ON_SAVE = UPDATE_ON_SAVE.toLocaleLowerCase();
const LOWER_ANCHOR_MODE = ANCHOR_MODE.toLocaleLowerCase();

const ANCHOR_MODE_LIST =
    [
        "github.com",
        "bitbucket.org",
        "ghost.org",
        "gitlab.com"
    ]

export class MarkdownTocTools {

    options = {
        DEPTH_FROM: 1,
        DEPTH_TO: 6,
        INSERT_ANCHOR: false,
        WITH_LINKS: true,
        ORDERED_LIST: false,
        UPDATE_ON_SAVE: true,
        ANCHOR_MODE: ANCHOR_MODE_LIST[0]
    };
    optionsFlag = [];
    saveBySelf = false;
    markdownHeaderProvider: MarkdownHeaderProvider;

    constructor() {
        vscode.workspace.onDidSaveTextDocument(doc => this.notifyDocumentSave());

        this.markdownHeaderProvider = new MarkdownHeaderProvider();
        vscode.window.registerTreeDataProvider('MarkdownToc', this.markdownHeaderProvider);
        vscode.commands.registerCommand('extension.selectTOCHeader', range => this.markdownHeaderProvider.revealHeader(range));
    }

    // Public function
    public updateMarkdownToc(isBySave: boolean = false) {
        let editor = vscode.window.activeTextEditor;
        let markdownTocTools = this;

        vscode.window.activeTextEditor.edit(function (editBuilder) {
            let tocRange = markdownTocTools.getTocRange();
            markdownTocTools.updateOptions(tocRange);

            if (isBySave && ((!markdownTocTools.options.UPDATE_ON_SAVE) || (tocRange == null))) return false;

            let insertPosition = editor.selection.active;
            // save options, and delete last insert
            if (tocRange != null) {
                insertPosition = tocRange.start;
                editBuilder.delete(tocRange);
                markdownTocTools.deleteAnchor(editBuilder);
            }
            let headerList = markdownTocTools.getHeaderList();
            markdownTocTools.markdownHeaderProvider.updateHeaderList(headerList);

            markdownTocTools.createToc(editBuilder, headerList, insertPosition);
            markdownTocTools.insertAnchor(editBuilder, headerList);
        });
        return true;
    }

    public deleteMarkdownToc() {
        let markdownTocTools = this;

        vscode.window.activeTextEditor.edit(function (editBuilder) {
            let tocRange = markdownTocTools.getTocRange();
            if (tocRange == null) return;

            editBuilder.delete(tocRange);
            markdownTocTools.deleteAnchor(editBuilder);
        });
    }


    public updateMarkdownSections() {
        let tocRange = this.getTocRange();
        this.updateOptions(tocRange);
        let headerList = this.getHeaderList();

        vscode.window.activeTextEditor.edit(function (editBuilder) {
            headerList.forEach(element => {
                let newHeader = element.header + " " + element.orderedList + " " + element.baseTitle
                editBuilder.replace(element.range, newHeader);
            });
        });
    }

    public deleteMarkdownSections() {
        let tocRange = this.getTocRange();
        this.updateOptions(tocRange);
        let headerList = this.getHeaderList();

        vscode.window.activeTextEditor.edit(function (editBuilder) {
            headerList.forEach(element => {
                let newHeader = element.header + " " + element.baseTitle
                editBuilder.replace(element.range, newHeader);
            });
        });
    }

    public notifyDocumentSave() {
        // Prevent save again
        if (this.saveBySelf) {
            this.saveBySelf = false;
            return;
        }
        let doc = vscode.window.activeTextEditor.document;
        if (doc.languageId != 'markdown') return;
        if (this.updateMarkdownToc(true)) {
            doc.save();
            this.saveBySelf = true;
        }
    }

    // Private function
    private getTocRange() {
        let doc = vscode.window.activeTextEditor.document;
        let start, stop: vscode.Position;

        for (let index = 0; index < doc.lineCount; index++) {
            let lineText = doc.lineAt(index).text;
            if ((start == null) && (lineText.match(REGEXP_TOC_START))) {
                start = new vscode.Position(index, 0);
            } else if (lineText.match(REGEXP_TOC_STOP)) {
                stop = new vscode.Position(index, lineText.length);
                break;
            }
        }
        if ((start != null) && (stop != null)) {
            return new vscode.Range(start, stop);
        }
        return null;
    }

    private updateOptions(tocRange: vscode.Range) {
        this.loadConfigurations();
        this.loadCustomOptions(tocRange);
    }

    private loadConfigurations() {
        this.options.DEPTH_FROM = <number>vscode.workspace.getConfiguration('markdown-toc').get('depthFrom');
        this.options.DEPTH_TO = <number>vscode.workspace.getConfiguration('markdown-toc').get('depthTo');
        this.options.INSERT_ANCHOR = <boolean>vscode.workspace.getConfiguration('markdown-toc').get('insertAnchor');
        this.options.WITH_LINKS = <boolean>vscode.workspace.getConfiguration('markdown-toc').get('withLinks');
        this.options.ORDERED_LIST = <boolean>vscode.workspace.getConfiguration('markdown-toc').get('orderedList');
        this.options.UPDATE_ON_SAVE = <boolean>vscode.workspace.getConfiguration('markdown-toc').get('updateOnSave');
        this.options.ANCHOR_MODE = <string>vscode.workspace.getConfiguration('markdown-toc').get('anchorMode');
    }

    private loadCustomOptions(tocRange: vscode.Range) {
        this.optionsFlag = [];
        if (tocRange == null) return;
        let optionsText = vscode.window.activeTextEditor.document.lineAt(tocRange.start.line).text;
        let options = optionsText.match(REGEXP_TOC_CONFIG);
        if (options == null) return;

        options.forEach(element => {
            let pair = REGEXP_TOC_CONFIG_ITEM.exec(element)
            let key = pair[1].toLocaleLowerCase();
            let value = pair[2];

            switch (key) {
                case LOWER_DEPTH_FROM:
                    this.optionsFlag.push(DEPTH_FROM);
                    this.options.DEPTH_FROM = this.parseValidNumber(value);
                    break;
                case LOWER_DEPTH_TO:
                    this.optionsFlag.push(DEPTH_TO);
                    this.options.DEPTH_TO = Math.max(this.parseValidNumber(value), this.options.DEPTH_FROM);
                    break;
                case LOWER_INSERT_ANCHOR:
                    this.optionsFlag.push(INSERT_ANCHOR);
                    this.options.INSERT_ANCHOR = this.parseBool(value);
                    break;
                case LOWER_WITH_LINKS:
                    this.optionsFlag.push(WITH_LINKS);
                    this.options.WITH_LINKS = this.parseBool(value);
                    break;
                case LOWER_ORDERED_LIST:
                    this.optionsFlag.push(ORDERED_LIST);
                    this.options.ORDERED_LIST = this.parseBool(value);
                    break;
                case LOWER_UPDATE_ON_SAVE:
                    this.optionsFlag.push(UPDATE_ON_SAVE);
                    this.options.UPDATE_ON_SAVE = this.parseBool(value);
                    break;
                case LOWER_ANCHOR_MODE:
                    this.optionsFlag.push(ANCHOR_MODE);
                    this.options.ANCHOR_MODE = this.parseValidAnchorMode(value);
                    break;
            }
        });
    }

    private insertAnchor(editBuilder: vscode.TextEditorEdit, headerList: any[]) {
        if (!this.options.INSERT_ANCHOR) return;
        headerList.forEach(element => {
            let name = element.hash.match(REGEXP_ANCHOR)[1];
            let text = ['<a id="markdown-', name, '" name="', name, '"></a>\n'];
            let insertPosition = new vscode.Position(element.line, 0);
            editBuilder.insert(insertPosition, text.join(''));
        });
    }

    private deleteAnchor(editBuilder: vscode.TextEditorEdit) {
        let doc = vscode.window.activeTextEditor.document;
        for (let index = 0; index < doc.lineCount; index++) {
            let lineText = doc.lineAt(index).text;
            if (lineText.match(REGEXP_MARKDOWN_ANCHOR) == null) continue;

            let range = new vscode.Range(new vscode.Position(index, 0), new vscode.Position(index + 1, 0));
            editBuilder.delete(range);
        }
    }

    private createToc(editBuilder: vscode.TextEditorEdit, headerList: any[], insertPosition: vscode.Position) {
        let lineEnding = <string>vscode.workspace.getConfiguration("files").get("eol");
        let tabSize = <number>vscode.workspace.getConfiguration("[markdown]")["editor.tabSize"];
        let insertSpaces = <boolean>vscode.workspace.getConfiguration("[markdown]")["editor.insertSpaces"];

        if (tabSize === undefined || tabSize === null) {
            tabSize = <number>vscode.workspace.getConfiguration("editor").get("tabSize");
        }
        if (insertSpaces === undefined || insertSpaces === null) {
            insertSpaces = <boolean>vscode.workspace.getConfiguration("editor").get("insertSpaces");
        }

        let tab = '\t';
        if (insertSpaces && tabSize > 0) {
            tab = " ".repeat(tabSize);
        }

        let optionsText = [];
        optionsText.push('<!-- TOC ');
        if (this.optionsFlag.indexOf(DEPTH_FROM) != -1) optionsText.push(DEPTH_FROM + ':' + this.options.DEPTH_FROM + ' ');
        if (this.optionsFlag.indexOf(DEPTH_TO) != -1) optionsText.push(DEPTH_TO + ':' + this.options.DEPTH_TO + ' ');
        if (this.optionsFlag.indexOf(INSERT_ANCHOR) != -1) optionsText.push(INSERT_ANCHOR + ':' + this.options.INSERT_ANCHOR + ' ');
        if (this.optionsFlag.indexOf(ORDERED_LIST) != -1) optionsText.push(ORDERED_LIST + ':' + this.options.ORDERED_LIST + ' ');
        if (this.optionsFlag.indexOf(UPDATE_ON_SAVE) != -1) optionsText.push(UPDATE_ON_SAVE + ':' + this.options.UPDATE_ON_SAVE + ' ');
        if (this.optionsFlag.indexOf(WITH_LINKS) != -1) optionsText.push(WITH_LINKS + ':' + this.options.WITH_LINKS + ' ');
        if (this.optionsFlag.indexOf(ANCHOR_MODE) != -1) optionsText.push(ANCHOR_MODE + ':' + this.options.ANCHOR_MODE + ' ');
        optionsText.push('-->' + lineEnding);

        let text = [];
        text.push(optionsText.join(''));

        let indicesOfDepth = Array.apply(null, new Array(this.options.DEPTH_TO - this.options.DEPTH_FROM + 1)).map(Number.prototype.valueOf, 0);
        let waitResetList = Array.apply(null, new Array(indicesOfDepth.length)).map(Boolean.prototype.valueOf, false);

        let minDepth = 6;
        headerList.forEach(element => {
            minDepth = Math.min(element.depth, minDepth);
        });
        let startDepth = Math.max(minDepth, this.options.DEPTH_FROM);

        headerList.forEach(element => {
            if (element.depth <= this.options.DEPTH_TO) {
                let length = element.depth - startDepth;
                for (var index = 0; index < waitResetList.length; index++) {
                    if (waitResetList[index] && (length < index)) {
                        indicesOfDepth[index] = 0;
                        waitResetList[index] = false;
                    }
                }

                let row = [
                    tab.repeat(length),
                    this.options.ORDERED_LIST ? (++indicesOfDepth[length] + '. ') : '- ',
                    this.options.WITH_LINKS ? element.hash : element.title
                ];
                text.push(row.join(''));
                waitResetList[length] = true;
            }
        });

        text.push(lineEnding + "<!-- /TOC -->");
        editBuilder.insert(insertPosition, text.join(lineEnding));
    }

    private getHeaderList() {
        let doc = vscode.window.activeTextEditor.document;
        let headerList = [];
        let hashMap = {};
        let isInCode = 0;
        let indicesOfDepth = Array.apply(null, new Array(6)).map(Number.prototype.valueOf, 0);
        for (let index = 0; index < doc.lineCount; index++) {
            let lineText = doc.lineAt(index).text;
            let codeResult1 = lineText.match(REGEXP_CODE_BLOCK1);
            let codeResult2 = lineText.match(REGEXP_CODE_BLOCK2);
            if (isInCode == 0) {
                isInCode = codeResult1 != null ? 1 : (codeResult2 != null ? 2 : isInCode);
            } else if (isInCode == 1) {
                isInCode = codeResult1 != null ? 0 : isInCode;
            } else if (isInCode == 2) {
                isInCode = codeResult2 != null ? 0 : isInCode;
            }
            if (isInCode) continue;

            let headerResult = lineText.match(REGEXP_HEADER);
            if (headerResult == null) continue;

            let depth = headerResult[1].length;
            if (depth < this.options.DEPTH_FROM) continue;
            if (depth > this.options.DEPTH_TO) continue;

            if (lineText.match(REGEXP_IGNORE_TITLE)) continue;

            for (var i = depth; i <= this.options.DEPTH_TO; i++) {
                indicesOfDepth[depth] = 0;
            }
            indicesOfDepth[depth - 1]++;

            let orderedListStr = ""
            for (var i = this.options.DEPTH_FROM - 1; i < depth; i++) {
                orderedListStr += indicesOfDepth[i].toString() + ".";
            }

            let title = lineText.substr(depth).trim();
            title = title.replace(/\[(.+)]\([^)]*\)/gi, "$1");  // replace link
            title = title.replace(/<!--.+-->/gi, "");           // replace comment
            title = title.replace(/\#*_/gi, "").trim();         // replace special char

            if (hashMap[title] == null) {
                hashMap[title] = 0
            } else {
                hashMap[title] += 1;
            }

            let hash = this.getHash(title, this.options.ANCHOR_MODE, hashMap[title]);
            headerList.push({
                line: index,
                depth: depth,
                title: title,
                hash: hash,
                range: new vscode.Range(index, 0, index, lineText.length),
                header: headerResult[1],
                orderedList: orderedListStr,
                baseTitle: headerResult[3]
            });
        }
        return headerList;
    }

    private getHash(headername: string, mode: string, repetition: number) {
        let anchor = require('anchor-markdown-header');
        return decodeURI(anchor(headername, mode, repetition));
    }

    private parseValidNumber(value: string) {
        let num = parseInt(value);
        if (num < 1) {
            return 1;
        }
        if (num > 6) {
            return 6;
        }
        return num;
    }

    private parseValidAnchorMode(value: string) {
        if (ANCHOR_MODE_LIST.indexOf(value) != -1) {
            return value;
        }
        return ANCHOR_MODE_LIST[0];
    }

    private parseBool(value: string) {
        return value.toLocaleLowerCase() == 'true';
    }

    dispose() {
    }
}