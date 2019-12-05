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

  const ignoreFilesFileEnding = ['settings.json', 'keybindings.json', '.git']

  let currentStepsBack = 0
  let ignoreStepsBackResetCount = 0
  let editList: Edit[] = []

  const fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false)
  const onCreate = fileSystemWatcher.onDidCreate((uri: vscode.Uri) => {
    console.log(`create: ${uri.fsPath}`)
  })
  const onDelete = fileSystemWatcher.onDidDelete((uri: vscode.Uri) => {
    console.log(`delete: ${uri.fsPath}`)
  })

  vscode.window.onDidChangeTextEditorSelection((e: vscode.TextEditorSelectionChangeEvent) => {
    if (ignoreStepsBackResetCount > 0) {
      ignoreStepsBackResetCount -= 1
    } else {
      // console.log('resetting steps back');
      currentStepsBack = 0
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

        const line = change.range.start.line
        const lastEdit: Edit | undefined = editList[editList.length - 1]
        const changeIsNewline = change.text.startsWith('\n') || change.text.startsWith('\r\n')

        // skip trivial one character additions on same line as last edit:
        if (lastEdit !== undefined && lastEdit.filepath === filepath && lastEdit.line === line) {
          if (change.text.length === 1 && changeIsNewline === false) {
            // console.log('skipping trivial change');
            return
          } else {
            // console.log('removing old change');
            editList.splice(-1, 1)
          }
        }

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
      const edit = editList[editList.length - 1 - currentStepsBack]
      if (getConfig().logDebug) {
        console.log(`moving selection to line ${edit.line} in ${edit.filepath}`)
      }
      if (edit) {
        moveToEdit(edit)
        currentStepsBack++
      }
    },
  )

  const moveToEdit = async (edit: Edit) => {
    const activeFilepath = vscode.window.activeTextEditor?.document.uri.path

    let activeEditor: vscode.TextEditor
    if (activeFilepath !== edit.filepath) {
      const textdocument = await vscode.workspace.openTextDocument(edit.filepath)
      activeEditor = await vscode.window.showTextDocument(textdocument)
      ignoreStepsBackResetCount += 2
    } else {
      activeEditor = vscode.window.activeTextEditor!
      ignoreStepsBackResetCount += 1
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

export function deactivate() {
	// nothing to do here!
}