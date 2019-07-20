// The module 'vscode' contains the VS Code extensibility API
// Import the necessary extensibility types to use in your code below
import {
    window,
    commands,
    ExtensionContext,
    TextDocument,
    workspace,
    Position,
    Range,
    TextEditorEdit
} from 'vscode';

import { Header } from './models/Header';
import { OptionKeys } from './models/OptionKeys';
import { isNullOrUndefined } from 'util';

const REGEXP_TOC_START = /\s*<!--(.*)TOC(.*)-->/gi;
const REGEXP_TOC_STOP = /\s*<!--(.*)\/TOC(.*)-->/gi;
const REGEXP_TOC_CONFIG = /\w+[:=][\w.]+/gi;
const REGEXP_TOC_CONFIG_ITEM = /(\w+)[:=]([\w.]+)/;
const REGEXP_MARKDOWN_ANCHOR = /^<a id="markdown-.+" name=".+"><\/a\>/;
const REGEXP_HEADER = /^(\#{1,6})\s*(.+)/;
const REGEXP_CODE_BLOCK1 = /^```/;
const REGEXP_CODE_BLOCK2 = /^~~~/;
const REGEXP_ANCHOR = /\[.+\]\(#(.+)\)/
const REGEXP_IGNORE_TITLE = /<!-- TOC ignore:true -->/

const optionKeys = new OptionKeys();

// const DEPTH_FROM = "depthFrom";
// const DEPTH_TO = "depthTo";
// const INSERT_ANCHOR = "insertAnchor";
// const WITH_LINKS = "withLinks";
// const ORDERED_LIST = "orderedList";
// const UPDATE_ON_SAVE = "updateOnSave";
// const ANCHOR_MODE = "anchorMode";

const LOWER_DEPTH_FROM = optionKeys.DEPTH_FROM.toLocaleLowerCase();
const LOWER_DEPTH_TO = optionKeys.DEPTH_TO.toLocaleLowerCase();
const LOWER_INSERT_ANCHOR = optionKeys.INSERT_ANCHOR.toLocaleLowerCase();
const LOWER_WITH_LINKS = optionKeys.WITH_LINKS.toLocaleLowerCase();
const LOWER_ORDERED_LIST = optionKeys.ORDERED_LIST.toLocaleLowerCase();
const LOWER_UPDATE_ON_SAVE = optionKeys.UPDATE_ON_SAVE.toLocaleLowerCase();
const LOWER_ANCHOR_MODE = optionKeys.ANCHOR_MODE.toLocaleLowerCase();

// const ANCHOR_MODE_LIST =
//     [
//         "github.com",
//         "bitbucket.org",
//         "ghost.org",
//         "gitlab.com"
//     ]

const EOL = require('os').EOL;

export function activate(context: ExtensionContext) {

    // create a MarkdownTocTools
    let markdownTocTools = new MarkdownTocTools();

    let disposable_updateMarkdownToc = commands.registerCommand('extension.updateMarkdownToc', () => { markdownTocTools.updateMarkdownToc(); });
    let disposable_deleteMarkdownToc = commands.registerCommand('extension.deleteMarkdownToc', () => { markdownTocTools.deleteMarkdownToc(); });
    let disposable_updateMarkdownSections = commands.registerCommand('extension.updateMarkdownSections', () => { markdownTocTools.updateMarkdownSections(); });
    let disposable_deleteMarkdownSections = commands.registerCommand('extension.deleteMarkdownSections', () => { markdownTocTools.deleteMarkdownSections(); });
    let disposable_saveMarkdownToc = workspace.onDidSaveTextDocument(() => { markdownTocTools.notifyDocumentSave(); });

    // Add to a list of disposables which are disposed when this extension is deactivated.
    context.subscriptions.push(disposable_updateMarkdownToc);
    context.subscriptions.push(disposable_deleteMarkdownToc);
    context.subscriptions.push(disposable_updateMarkdownSections);
    context.subscriptions.push(disposable_deleteMarkdownSections);
    context.subscriptions.push(disposable_saveMarkdownToc);
}

class MarkdownTocTools {

    options = {
        DEPTH_FROM: 1,
        DEPTH_TO: 6,
        INSERT_ANCHOR: false,
        WITH_LINKS: true,
        ORDERED_LIST: false,
        UPDATE_ON_SAVE: true,
        ANCHOR_MODE: optionKeys.ANCHOR_MODE_LIST[0]
    };
    optionsFlag: string[] = [];
    saveBySelf = false;

    // Public function
    public updateMarkdownToc(isBySave: boolean = false) {
        let markdownTocTools = this;
        let editor = window.activeTextEditor;

        if (editor == undefined) {
            return false;
        }

        let insertPosition = editor.selection.active;
        editor.edit(function (editBuilder) {
            let tocRange = markdownTocTools.getTocRange();
            markdownTocTools.updateOptions(tocRange);

            if (isBySave && ((!markdownTocTools.options.UPDATE_ON_SAVE) || (tocRange == null))) return false;

            // save options, and delete last insert
            if (tocRange != null) {
                insertPosition = tocRange.start;
                editBuilder.delete(tocRange);
                markdownTocTools.deleteAnchor(editBuilder);
            }
            let headerList = markdownTocTools.getHeaderList();

            markdownTocTools.createToc(editBuilder, headerList, insertPosition);
            markdownTocTools.insertAnchor(editBuilder, headerList);
        });

        return true;
    }

    public deleteMarkdownToc() {
        let markdownTocTools = this;
        let editor = window.activeTextEditor;

        if (editor == undefined) {
            return false;
        }

        editor.edit(function (editBuilder) {
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

        let editor = window.activeTextEditor;
        if (editor != undefined) {
            editor.edit(function (editBuilder) {
                headerList.forEach(element => {
                    let newHeader = element.header + " " + element.orderedList + " " + element.baseTitle
                    editBuilder.replace(element.range, newHeader);
                });
            });
        }
    }

    public deleteMarkdownSections() {
        let tocRange = this.getTocRange();
        this.updateOptions(tocRange);
        let headerList = this.getHeaderList();

        let editor = window.activeTextEditor;
        if (editor != undefined && headerList != undefined) {
            editor.edit(function (editBuilder) {
                headerList.forEach(element => {
                    let newHeader = element.header + " " + element.baseTitle
                    editBuilder.replace(element.range, newHeader);
                });
            });
        }
    }

    public notifyDocumentSave() {
        // Prevent save again
        if (this.saveBySelf) {
            this.saveBySelf = false;
            return;
        }

        let editor = window.activeTextEditor;
        if (editor != undefined) {
            let doc = editor.document;

            if (doc.languageId != 'markdown') return;
            if (this.updateMarkdownToc(true)) {
                doc.save();
                this.saveBySelf = true;
            }
        }
    }

    // Private function
    private getTocRange() {
        let editor = window.activeTextEditor;
        if (editor == undefined) {
            return null;
        }

        let doc = editor.document;

        let start, stop: Position | undefined;

        for (let index = 0; index < doc.lineCount; index++) {
            let lineText = doc.lineAt(index).text;
            if ((start == null) && (lineText.match(REGEXP_TOC_START))) {
                start = new Position(index, 0);
            } else if (lineText.match(REGEXP_TOC_STOP)) {
                stop = new Position(index, lineText.length);
                break;
            }
        }

        if ((start != null) && (stop != null)) {
            return new Range(start, stop);
        }

        return null;
    }

    private updateOptions(tocRange: Range | null) {
        this.loadConfigurations();
        this.loadCustomOptions(tocRange);
    }

    private loadConfigurations() {
        this.options.DEPTH_FROM = <number>workspace.getConfiguration('markdown-toc').get('depthFrom');
        this.options.DEPTH_TO = <number>workspace.getConfiguration('markdown-toc').get('depthTo');
        this.options.INSERT_ANCHOR = <boolean>workspace.getConfiguration('markdown-toc').get('insertAnchor');
        this.options.WITH_LINKS = <boolean>workspace.getConfiguration('markdown-toc').get('withLinks');
        this.options.ORDERED_LIST = <boolean>workspace.getConfiguration('markdown-toc').get('orderedList');
        this.options.UPDATE_ON_SAVE = <boolean>workspace.getConfiguration('markdown-toc').get('updateOnSave');
        this.options.ANCHOR_MODE = <string>workspace.getConfiguration('markdown-toc').get('anchorMode');
    }

    private loadCustomOptions(tocRange: Range | null) {
        this.optionsFlag = [];
        if (tocRange == null || tocRange == null) return;
        let editor = window.activeTextEditor;
        if (editor == undefined) return;
        let optionsText = editor.document.lineAt(tocRange.start.line).text;
        let options = optionsText.match(REGEXP_TOC_CONFIG);
        if (options == null) return;

        options.forEach(element => {
            let pair = REGEXP_TOC_CONFIG_ITEM.exec(element)

            if (pair != null) {
                let key = pair[1].toLocaleLowerCase();
                let value = pair[2];

                switch (key) {
                    case LOWER_DEPTH_FROM:
                        this.optionsFlag.push(optionKeys.DEPTH_FROM);
                        this.options.DEPTH_FROM = this.parseValidNumber(value);
                        break;
                    case LOWER_DEPTH_TO:
                        this.optionsFlag.push(optionKeys.DEPTH_TO);
                        this.options.DEPTH_TO = Math.max(this.parseValidNumber(value), this.options.DEPTH_FROM);
                        break;
                    case LOWER_INSERT_ANCHOR:
                        this.optionsFlag.push(optionKeys.INSERT_ANCHOR);
                        this.options.INSERT_ANCHOR = this.parseBool(value);
                        break;
                    case LOWER_WITH_LINKS:
                        this.optionsFlag.push(optionKeys.WITH_LINKS);
                        this.options.WITH_LINKS = this.parseBool(value);
                        break;
                    case LOWER_ORDERED_LIST:
                        this.optionsFlag.push(optionKeys.ORDERED_LIST);
                        this.options.ORDERED_LIST = this.parseBool(value);
                        break;
                    case LOWER_UPDATE_ON_SAVE:
                        this.optionsFlag.push(optionKeys.UPDATE_ON_SAVE);
                        this.options.UPDATE_ON_SAVE = this.parseBool(value);
                        break;
                    case LOWER_ANCHOR_MODE:
                        this.optionsFlag.push(optionKeys.ANCHOR_MODE);
                        this.options.ANCHOR_MODE = this.parseValidAnchorMode(value);
                        break;
                }
            }

        });
    }

    private insertAnchor(editBuilder: TextEditorEdit, headerList: any[]) {
        if (!this.options.INSERT_ANCHOR) return;
        headerList.forEach(element => {
            let name = element.hash.match(REGEXP_ANCHOR)[1];
            let text = ['<a id="markdown-', name, '" name="', name, '"></a>\n'];
            let insertPosition = new Position(element.line, 0);
            editBuilder.insert(insertPosition, text.join(''));
        });
    }

    private deleteAnchor(editBuilder: TextEditorEdit) {
        let editor = window.activeTextEditor;
        if (editor != undefined) {
            let doc = editor.document;
            for (let index = 0; index < doc.lineCount; index++) {
                let lineText = doc.lineAt(index).text;
                if (lineText.match(REGEXP_MARKDOWN_ANCHOR) == null) continue;

                let range = new Range(new Position(index, 0), new Position(index + 1, 0));
                editBuilder.delete(range);
            }
        }
    }

    private createToc(editBuilder: TextEditorEdit, headerList: any[], insertPosition: Position) {
        let lineEnding = <string>workspace.getConfiguration("files").get("eol");
        let tabSize = <number>workspace.getConfiguration("[markdown]")["editor.tabSize"];
        let insertSpaces = <boolean>workspace.getConfiguration("[markdown]")["editor.insertSpaces"];

        if (lineEnding === 'auto') {
            lineEnding = <string>EOL;
        }
        if (tabSize === undefined || tabSize === null) {
            tabSize = <number>workspace.getConfiguration("editor").get("tabSize");
        }
        if (insertSpaces === undefined || insertSpaces === null) {
            insertSpaces = <boolean>workspace.getConfiguration("editor").get("insertSpaces");
        }

        let tab = '\t';
        if (insertSpaces && tabSize > 0) {
            tab = " ".repeat(tabSize);
        }

        let optionsText = [];
        optionsText.push('<!-- TOC ');
        if (this.optionsFlag.indexOf(optionKeys.DEPTH_FROM) != -1) optionsText.push(optionKeys.DEPTH_FROM + ':' + this.options.DEPTH_FROM + ' ');
        if (this.optionsFlag.indexOf(optionKeys.DEPTH_TO) != -1) optionsText.push(optionKeys.DEPTH_TO + ':' + this.options.DEPTH_TO + ' ');
        if (this.optionsFlag.indexOf(optionKeys.INSERT_ANCHOR) != -1) optionsText.push(optionKeys.INSERT_ANCHOR + ':' + this.options.INSERT_ANCHOR + ' ');
        if (this.optionsFlag.indexOf(optionKeys.ORDERED_LIST) != -1) optionsText.push(optionKeys.ORDERED_LIST + ':' + this.options.ORDERED_LIST + ' ');
        if (this.optionsFlag.indexOf(optionKeys.UPDATE_ON_SAVE) != -1) optionsText.push(optionKeys.UPDATE_ON_SAVE + ':' + this.options.UPDATE_ON_SAVE + ' ');
        if (this.optionsFlag.indexOf(optionKeys.WITH_LINKS) != -1) optionsText.push(optionKeys.WITH_LINKS + ':' + this.options.WITH_LINKS + ' ');
        if (this.optionsFlag.indexOf(optionKeys.ANCHOR_MODE) != -1) optionsText.push(optionKeys.ANCHOR_MODE + ':' + this.options.ANCHOR_MODE + ' ');
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

        let headerList: Header[] = [];

        let editor = window.activeTextEditor;

        if (editor != undefined) {

            let doc = editor.document;

            let hashMap: any = {};
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
                let baseTitle = title.replace(/^(?:\d+\.)+/, "").trim(); // title without section number

                title = this.cleanUpTitle(title);

                if (hashMap[title] == null) {
                    hashMap[title] = 0
                } else {
                    hashMap[title] += 1;
                }

                let hash = this.getHash(title, this.options.ANCHOR_MODE, hashMap[title]);

                let headerRange = new Range(index, 0, index, lineText.length);

                headerList.push(new Header(index, depth, title, hash, headerRange, headerResult[1], orderedListStr, baseTitle));
            }

            return headerList;
        }

        return headerList;
    }

    private cleanUpTitle(dirtyTitle: string) {
        let title = dirtyTitle.replace(/\[(.+)]\([^)]*\)/gi, "$1");  // replace link
        title = title.replace(/<!--.+-->/gi, "");           // replace comment
        title = title.replace(/\#*_/gi, "").trim();         // replace special char

        return title;
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

        if (optionKeys.ANCHOR_MODE_LIST.indexOf(value) != -1) {
            return value;
        }

        return optionKeys.ANCHOR_MODE_LIST[0];
    }

    private parseBool(value: string) {
        return value.toLocaleLowerCase() == 'true';
    }

    dispose() {
    }
}
