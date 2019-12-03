import * as vscode from 'vscode';

const EDIT_LIST_MAX_LENGTH = 20;

type Edit = {
	filepath: string
	line: number
	character: number
	range: number
};

export function activate(context: vscode.ExtensionContext) {

	let currentStepsBack = 0;
	let ignoreNextStepsBackReset = false;
	let editList: Edit[] = [];

	const fileSystemWatcher = vscode.workspace.createFileSystemWatcher("**/*", false, true, false);
	const onCreate = fileSystemWatcher.onDidCreate((uri: vscode.Uri) => {
		console.log(`create: ${uri.fsPath}`);
	});
	const onDelete = fileSystemWatcher.onDidDelete((uri: vscode.Uri) => {
		console.log(`delete: ${uri.fsPath}`);
	});

	vscode.window.onDidChangeTextEditorSelection((e: vscode.TextEditorSelectionChangeEvent) => {
		if (ignoreNextStepsBackReset) {
			ignoreNextStepsBackReset = false;
		} else {
			currentStepsBack = 0;
		}
	});

	const documentChangeListener = vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
		const filepath = e.document.uri.fsPath;

		e.contentChanges.forEach((change) => {
			const line = change.range.start.line;
			const character = change.range.start.character;
			const range = change.rangeLength;
			// console.log(`line: ${line}, ${character}, ${range},${change.range.end}, "${change.text}"`)

			const lastEdit = editList[editList.length - 1];
			const numberOfNewlines = change.text?.match(/\n/g)?.length;
			const startsWithNewline = change.text && (change.text[0] === '\n' || change.text.substring(0,2) === '\r\n');
			// console.log(`startsWithNewline: ${startsWithNewline}`);

			const newEdit = {
				filepath,
				line: line + (startsWithNewline ? 1 : 0),
				character,
				range,
			};

			// skip edits on same line as last one:
			if (lastEdit !== undefined && lastEdit.filepath === filepath && lastEdit.line === line) {
				// console.log('skipping this edit');
				return;
			}


			// adjust old edits if we add new lines:
			if (numberOfNewlines !== undefined && numberOfNewlines > 0) {
				// console.log(`newlines: ${numberOfNewlines}`)
				editList = editList.map(edit => {
					if (edit.filepath === newEdit.filepath && edit.line >= newEdit.line) {
						return {
							...edit,
							line: edit.line + numberOfNewlines
						};
					} else {
						return edit;
					}
				});
			}



			editList.push(newEdit)

			if (editList.length > EDIT_LIST_MAX_LENGTH) {
				editList.splice(0, 1);
			}
		});
	});

	let gotoEditCommand = vscode.commands.registerCommand('navigateEditHistory.moveCursorToPreviousEdit', () => {
		const edit = editList[editList.length - 1 - currentStepsBack];
		editList.forEach((e, index) => {
			console.log(`${index}: ${e.line}`);
		});
		// console.log(`going to line ${edit.line}, indx ${editList.length - 1 - currentStepsBack}, stepsback ${currentStepsBack}`);
		moveToEdit(edit);
		currentStepsBack++;
	});

	const moveToEdit = async (edit: Edit) => {

		const activeFilepath = vscode.window.activeTextEditor?.document.uri.path;

		let activeEditor: vscode.TextEditor;
		if (activeFilepath !== edit.filepath) {
			const textdocument = await vscode.workspace.openTextDocument(edit.filepath);
			activeEditor = await vscode.window.showTextDocument(textdocument);
		} else {
			activeEditor = vscode.window.activeTextEditor!;
		}

		ignoreNextStepsBackReset = true;
		activeEditor.selection = new vscode.Selection(edit.line, edit.character, edit.line, edit.character);
		activeEditor.revealRange(new vscode.Range(edit.line, edit.character, edit.line, edit.character));
	};

	context.subscriptions.push(gotoEditCommand, onCreate, onDelete, documentChangeListener);
}

export function deactivate() { }
