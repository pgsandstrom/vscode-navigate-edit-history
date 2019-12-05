import * as vscode from 'vscode'
import { getConfig, reloadConfig } from './config'

type Edit = {
  filepath: string
  line: number
  character: number
  range: number
}

export function activate(context: vscode.ExtensionContext) {
  reloadConfig()

	const TIME_TO_IGNORE_NAVIGATION_AFTER_MOVE_COMMAND = 500;

  const ignoreFilesFileEnding = ['settings.json', 'keybindings.json', '.git']

  let currentStepsBack = 0
  let lastMoveToEditTime = 0
  let editList: Edit[] = []

  const fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false)
  const onCreate = fileSystemWatcher.onDidCreate((uri: vscode.Uri) => {
    console.log(`create: ${uri.fsPath}`)
  })
  const onDelete = fileSystemWatcher.onDidDelete((uri: vscode.Uri) => {
    console.log(`delete: ${uri.fsPath}`)
  })

  vscode.window.onDidChangeTextEditorSelection((e: vscode.TextEditorSelectionChangeEvent) => {
	const timeSinceMoveToEdit = new Date().getTime()- (lastMoveToEditTime)
    if (timeSinceMoveToEdit > TIME_TO_IGNORE_NAVIGATION_AFTER_MOVE_COMMAND) {
	  if(currentStepsBack > 0) {
		if (getConfig().logDebug) {
			console.log(`Resetting step back history. Time since move to edit command: ${timeSinceMoveToEdit}`)
		}
		currentStepsBack = 0
	  }
    }
  })

  const documentChangeListener = vscode.workspace.onDidChangeTextDocument(
    (e: vscode.TextDocumentChangeEvent) => {
      const filepath = e.document.uri.fsPath

      if (ignoreFilesFileEnding.some(fileending => filepath.endsWith(fileending))) {
        return
      }

      e.contentChanges.forEach(change => {
        // TODO if deleting code, remove edits that were "inside" of them
        // TODO remove older edits that were on the same place?
		// TODO handle new files that are not yet saved to disk
		// TODO add option to center when moving

        const line = change.range.start.line
        const lastEdit: Edit | undefined = editList[editList.length - 1]
        // Someday maybe we can use "change.range.end" correctly instead of this to determine newlines:
        const changeIsNewline = change.text.startsWith('\n') || change.text.startsWith('\r\n')

        // skip trivial one character additions on same line as last edit:
        if (lastEdit !== undefined && lastEdit.filepath === filepath && lastEdit.line === line) {
          if (change.text.length === 1 && changeIsNewline === false) {
            return
          } else {
            if (getConfig().logDebug) {
              console.log('removing previous change')
            }
            editList.splice(-1, 1)
          }
        }

        // TODO activate this
        // remove last edit if it was adjacent to this one:
        // if (lastEdit !== undefined) {
        // 	console.log(`grejsimojs: ${Math.abs(lastEdit.line - line)}`)
        // }
        // if (lastEdit !== undefined && lastEdit.filepath === filepath && Math.abs(lastEdit.line - line) === 1) {
        // }

        const character = change.range.start.character
        const range = change.rangeLength

        // console.log(`line: ${line}, ${character}, ${range},${change.range.end}, "${change.text}"`)

        const numberOfNewLines = change.text?.match(/\n/g)?.length ?? 0
        // console.log(`numberOfNewLines: ${numberOfNewLines}`)
        const numberOfRemovedLines = change.range.end.line - change.range.start.line

        const newEdit = {
          filepath,
          line: line + (changeIsNewline ? 1 : 0),
          character,
          range,
        }

        // adjust old edits if we add new lines:
        if (numberOfNewLines > 0) {
          editList = editList.map(edit => {
            if (edit.filepath === newEdit.filepath && edit.line >= newEdit.line) {
              return {
                ...edit,
                line: edit.line + numberOfNewLines,
              }
            } else {
              return edit
            }
          })
        }

        // adjust old edits if we remove lines:
        if (numberOfRemovedLines > 0) {
          editList = editList.map(edit => {
            if (edit.filepath === newEdit.filepath && edit.line >= newEdit.line) {
              return {
                ...edit,
                line: edit.line - numberOfRemovedLines,
              }
            } else {
              return edit
            }
          })
        }

        if (getConfig().logDebug) {
          console.log(`Saving new edit at line ${newEdit.line} in ${newEdit.filepath}`)
        }
        editList.push(newEdit)

        if (editList.length > getConfig().maxSize) {
          editList.splice(0, 1)
        }
      })
    },
  )

  const gotoEditCommand = vscode.commands.registerCommand(
    'navigateEditHistory.moveCursorToPreviousEdit',
    () => {
      if (editList.length - 1 - currentStepsBack < 0) {
        if (getConfig().logDebug) {
          console.log('Reached the end of edit history, aborting action')
        }
        return
      }
      const edit = editList[editList.length - 1 - currentStepsBack]
      if (getConfig().logDebug) {
        console.log(`moving selection to line ${edit.line} in ${edit.filepath}`)
      }
      moveToEdit(edit)
      currentStepsBack++
    },
  )

  const moveToEdit = async (edit: Edit) => {
    lastMoveToEditTime = new Date().getTime()

    const activeFilepath = vscode.window.activeTextEditor?.document.uri.path

    let activeEditor: vscode.TextEditor
    if (normalizeFilepath(activeFilepath) !== normalizeFilepath(edit.filepath)) {
      const textdocument = await vscode.workspace.openTextDocument(edit.filepath)
      activeEditor = await vscode.window.showTextDocument(textdocument)
    } else {
      activeEditor = vscode.window.activeTextEditor!
    }

    activeEditor.selection = new vscode.Selection(
      edit.line,
      edit.character,
      edit.line,
      edit.character,
    )
    activeEditor.revealRange(new vscode.Range(edit.line, edit.character, edit.line, edit.character))
  }

  const onConfigChange = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('navigateEditHistory')) {
      reloadConfig()
    }
  })

  context.subscriptions.push(
    gotoEditCommand,
    onCreate,
    onDelete,
    documentChangeListener,
    onConfigChange,
  )
}

// This is needed since vscode can butcher filepaths in these different ways:
// /C:/work/code/tmp/Untitled-1.txt
// c:\work\code\tmp\Untitled-1.txt
const normalizeFilepath = (filepath?: string) => {
  return filepath !== undefined ? filepath.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() : undefined
}

export function deactivate() {
  // nothing to do here!
}
