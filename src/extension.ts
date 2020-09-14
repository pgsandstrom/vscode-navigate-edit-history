import * as vscode from 'vscode'
import { getConfig, reloadConfig } from './config'

interface Edit {
  line: number
  character: number
  filepath: string
  filename: string
  range: number
  lineText: string
}

export function activate(context: vscode.ExtensionContext) {
  const TIME_TO_IGNORE_NAVIGATION_AFTER_MOVE_COMMAND = 500

  let currentStepsBack = 0
  let lastMoveToEditTime = 0
  let editList: Edit[] = []

  const fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false)
  const onDelete = fileSystemWatcher.onDidDelete((uri: vscode.Uri) => {
    editList = editList.filter((edit) => {
      if (edit.filepath === uri.path) {
        if (getConfig().logDebug) {
          console.log(`Removing edit due to file being deleted: ${uri.path}`)
        }
        return false
      }
      return true
    })
  })

  const selectionDidChangeListener = vscode.window.onDidChangeTextEditorSelection(
    (e: vscode.TextEditorSelectionChangeEvent) => {
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
    },
  )

  const documentChangeListener = vscode.workspace.onDidChangeTextDocument(
    (e: vscode.TextDocumentChangeEvent) => {
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
      handleContentChange(lastContentChange, e)
    },
  )

  const handleContentChange = (
    change: vscode.TextDocumentContentChangeEvent,
    e: vscode.TextDocumentChangeEvent,
  ) => {
    // TODO if deleting code, remove edits that were "inside" of them
    // TODO remove older edits that were on the same place?

    const filepath = e.document.uri.path

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
    const lineText =
      vscode.window.activeTextEditor !== undefined
        ? vscode.window.activeTextEditor.document.lineAt(line).text.trim()
        : filepath
    const lastEdit = editList[editList.length - 1] as Edit | undefined
    // Someday maybe we can use "change.range.end" correctly instead of this to determine newlines. But that is currently bugged.
    const changeIsNewline = change.text.startsWith('\n') || change.text.startsWith('\r\n')

    if (
      lastEdit !== undefined &&
      lastEdit.filepath === filepath &&
      lastEdit.line === line &&
      lastEdit.lineText === lineText
    ) {
      if (changeIsNewline === false) {
        // skip changes on same line as last edit
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
    const currentWorkspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filepath))
    const filename =
      currentWorkspaceFolder !== undefined
        ? filepath.replace(currentWorkspaceFolder.uri.path, '')
        : filepath

    const numberOfNewLines = change.text.match(/\n/g)?.length ?? 0
    const numberOfRemovedLines = change.range.end.line - change.range.start.line

    const newEdit = {
      line: line + (changeIsNewline ? 1 : 0),
      character,
      filepath,
      filename,
      range,
      lineText,
    }

    // adjust old edits if we add new lines:
    if (numberOfNewLines > 0) {
      editList = editList.map((edit) => {
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
      editList = editList.map((edit) => {
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

  const moveToNextEdit = (onlyInCurrentFile: boolean) => {
    if (editList.length - 1 - currentStepsBack < 0) {
      if (getConfig().logDebug) {
        console.log('Reached the end of edit history, aborting action')
      }
      return
    }

    const initialCurrentStepBack = currentStepsBack

    const activeFilePath = vscode.window.activeTextEditor?.document.uri.path
    const activePosition = vscode.window.activeTextEditor?.selection.active

    const relevantEditList = editList.slice(0, editList.length - currentStepsBack).reverse()

    const edit = relevantEditList.find((e) => {
      currentStepsBack++
      // If we are currently standing on the edit, skip it:
      if (activeFilePath === e.filepath && activePosition?.line === e.line) {
        return false
      }

      if (onlyInCurrentFile && activeFilePath !== e.filepath) {
        return false
      }

      return e
    })

    if (edit === undefined) {
      // prevent a failed onlyInCurrentFile search from
      currentStepsBack = initialCurrentStepBack
      return
    }
    if (getConfig().logDebug) {
      console.log(`moving selection to line ${edit.line} in ${edit.filepath}`)
    }
    moveToEdit(edit, getRevealType())
  }

  const gotoEditCommand = vscode.commands.registerCommand(
    'navigateEditHistory.moveCursorToPreviousEdit',
    () => moveToNextEdit(false),
  )

  const gotoEditInCurrentFileCommand = vscode.commands.registerCommand(
    'navigateEditHistory.moveCursorToPreviousEditInCurrentFile',
    () => moveToNextEdit(true),
  )
  const moveToLine = async (
    filepath: string,
    line: number,
    character: number,
    revealType: vscode.TextEditorRevealType,
  ) => {
    lastMoveToEditTime = new Date().getTime()

    const activeFilepath = vscode.window.activeTextEditor?.document.uri.path

    let activeEditor: vscode.TextEditor
    if (activeFilepath !== filepath) {
      const textdocument = await vscode.workspace.openTextDocument(filepath)
      activeEditor = await vscode.window.showTextDocument(textdocument, {
        preserveFocus: true,
        preview: true,
      })
    } else {
      activeEditor = vscode.window.activeTextEditor!
    }

    activeEditor.selection = new vscode.Selection(line, character, line, character)
    const rangeToReveal = new vscode.Range(line, character, line, character)
    activeEditor.revealRange(rangeToReveal, revealType)
  }
  const moveToEdit = async (edit: Edit, revealType: vscode.TextEditorRevealType) => {
    await moveToLine(edit.filepath, edit.line, edit.character, revealType)
  }
  const getRevealType = () =>
    getConfig().centerOnReveal
      ? vscode.TextEditorRevealType.InCenterIfOutsideViewport
      : vscode.TextEditorRevealType.Default

  const list = () => {
    // Add extre edit payload for quickpicker
    type QuickPickEdit = vscode.QuickPickItem & { edit: Edit }

    const currentLine: number =
      vscode.window.activeTextEditor !== undefined
        ? vscode.window.activeTextEditor.selection.active.line + 1
        : 0
    const currentCharacter: number =
      vscode.window.activeTextEditor !== undefined
        ? vscode.window.activeTextEditor.selection.active.character + 1
        : 0
    const currentFilePath: string =
      vscode.window.activeTextEditor !== undefined
        ? vscode.window.activeTextEditor.document.uri.path
        : ''

    // push the items
    const items: QuickPickEdit[] = editList
      .map((edit: Edit) => {
        const discription = '(' + edit.line + ')'
        const pick: QuickPickEdit = {
          label: edit.lineText,
          description: discription,
          edit,
        }

        // If not in file add file path to detail
        if (edit.filepath !== currentFilePath) pick.detail = edit.filename

        return pick
      })
      .reverse()

    const options: vscode.QuickPickOptions = {
      placeHolder: 'Type a line number or a piece of code to navigate to',
      matchOnDescription: true,
      // matchOnDetail: true,
      onDidSelectItem: (item) => {
        const itemT = item as QuickPickEdit
        moveToEdit(itemT.edit, vscode.TextEditorRevealType.InCenter)
      },
    }

    vscode.window.showQuickPick(items, options).then((selection) => {
      if (typeof selection === 'undefined') {
        // Quick pick canceled, go back to last location
        moveToLine(
          currentFilePath,
          currentLine,
          currentCharacter,
          vscode.TextEditorRevealType.InCenter,
        )
        return
      }
      const itemT = selection
      moveToEdit(itemT.edit, vscode.TextEditorRevealType.InCenter)
    })
  }
  const listEditsCommand = vscode.commands.registerCommand('navigateEditHistory.list', () => list())

  const onConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('navigateEditHistory')) {
      reloadConfig()
    }
  })

  context.subscriptions.push(
    gotoEditCommand,
    gotoEditInCurrentFileCommand,
    listEditsCommand,
    onDelete,
    selectionDidChangeListener,
    documentChangeListener,
    onConfigChange,
  )
}

export function deactivate() {
  // nothing to do here!
}
