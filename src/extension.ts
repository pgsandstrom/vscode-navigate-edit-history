import * as vscode from 'vscode'
import { getConfig, reloadConfig } from './config'

interface Edit {
  filepath: string
  line: number
  character: number
  range: number
}

export function activate(context: vscode.ExtensionContext) {
  reloadConfig()

  const TIME_TO_IGNORE_NAVIGATION_AFTER_MOVE_COMMAND = 500

  let currentStepsBack = 0
  let lastMoveToEditTime = 0
  let editList: Edit[] = []

  const fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false)
  const onDelete = fileSystemWatcher.onDidDelete((uri: vscode.Uri) => {
    editList = editList.filter(edit => {
      if (edit.filepath === uri.path) {
        if (getConfig().logDebug) {
          console.log(`Removing edit due to file being deleted: ${uri.path}`)
        }
        return false
      }
      return true
    })
  })

  vscode.window.onDidChangeTextEditorSelection((e: vscode.TextEditorSelectionChangeEvent) => {
    const timeSinceMoveToEdit = new Date().getTime() - lastMoveToEditTime
    if (timeSinceMoveToEdit > TIME_TO_IGNORE_NAVIGATION_AFTER_MOVE_COMMAND) {
      if (currentStepsBack > 0) {
        if (getConfig().logDebug) {
          console.log(
            `Resetting step back history. Time since move to edit command: ${timeSinceMoveToEdit}`,
          )
        }
        currentStepsBack = 0
      }
    }
  })

  const documentChangeListener = vscode.workspace.onDidChangeTextDocument(
    (e: vscode.TextDocumentChangeEvent) => {
      const filepath = e.document.uri.path
      // console.log(`filepath: ${filepath}`)
      // console.log(`path: ${e.document.uri.path}`)
      // console.log(`scheme: ${e.document.uri.scheme}`)

      // actions such as autoformatting can fire loads of changes at the same time. Maybe we should ignore big chunks of changes?
      // TODO: perhaps there could be a smarter way to find autoformatting actions? Like, many changes that are not next to each other?
      // if (e.contentChanges.length > 30) {
      // return
      // }

      if (e.contentChanges.length === 0) {
        return
      }

      // we only use the last content change, because often that seems to be the relevant one:
      const lastContentChange = e.contentChanges[e.contentChanges.length - 1]
      handleContentChange(lastContentChange, filepath)
    },
  )

  const handleContentChange = (change: vscode.TextDocumentContentChangeEvent, filepath: string) => {
    // TODO if deleting code, remove edits that were "inside" of them
    // TODO remove older edits that were on the same place?

    if (
      vscode.window.activeTextEditor !== undefined &&
      filepath !== vscode.window.activeTextEditor.document.uri.path
    ) {
      if (getConfig().logDebug) {
        console.log(`Edited non-active editor, ignoring.`)
        console.log(`Active editor: ${vscode.window.activeTextEditor.document.uri.path}`)
        console.log(`Filepath: ${filepath}`)
      }
      return
    }

    const line = change.range.start.line
    const lastEdit = editList[editList.length - 1] as Edit | undefined
    // Someday maybe we can use "change.range.end" correctly instead of this to determine newlines:
    const changeIsNewline = change.text.startsWith('\n') || change.text.startsWith('\r\n')

    if (lastEdit !== undefined && lastEdit.filepath === filepath && lastEdit.line === line) {
      if (changeIsNewline === false) {
        // skip changes on same line as last edit:
        return
      }
    }

    if (/^[a-zA-Z1-9-]*$/.test(filepath)) {
      if (getConfig().logDebug) {
        console.log(
          `Not adding to edit history since unsaved files are not supported. Path: ${filepath}`,
        )
      }
      return
    }

    // remove last edit if it was adjacent to this one:
    if (lastEdit !== undefined && lastEdit.filepath === filepath) {
      const lineDiffToLastEdit = Math.abs(lastEdit.line - line)
      if (getConfig().groupEditsWithinLines >= lineDiffToLastEdit) {
        if (getConfig().logDebug) {
          console.log(
            `Change was ${lineDiffToLastEdit} lines away from last edit, so removing last edit.`,
          )
        }
        editList.splice(-1, 1)
      }
    }

    const character = change.range.start.character
    const range = change.rangeLength

    const numberOfNewLines = change.text.match(/\n/g)?.length ?? 0
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

    if (editList.length > getConfig().maxHistorySize) {
      editList.splice(0, 1)
    }
  }

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
    if (activeFilepath !== edit.filepath) {
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
    const rangeToReveal = new vscode.Range(edit.line, edit.character, edit.line, edit.character)
    activeEditor.revealRange(
      rangeToReveal,
      getConfig().centerOnReveal
        ? vscode.TextEditorRevealType.InCenterIfOutsideViewport
        : vscode.TextEditorRevealType.Default,
    )
  }

  const onConfigChange = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('navigateEditHistory')) {
      reloadConfig()
    }
  })

  context.subscriptions.push(gotoEditCommand, onDelete, documentChangeListener, onConfigChange)
}

export function deactivate() {
  // nothing to do here!
}
