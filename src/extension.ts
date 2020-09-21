import * as vscode from 'vscode'
import { getConfig, reloadConfig } from './config'

interface Edit {
  line: number
  character: number
  filepath: string
  filename: string
  lineText: string
}

export function activate(context: vscode.ExtensionContext) {
  // get edit list from storage
  let editList: Edit[] = context.workspaceState.get('editList') || []
  let currentStepsBack = 0
  let lastMoveToEditTime = 0

  //
  const fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false)
  const onDeleteListener = fileSystemWatcher.onDidDelete((uri: vscode.Uri) => {
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
      const TIME_TO_IGNORE_NAVIGATION_AFTER_MOVE_COMMAND = 500
      const timeSinceMoveToEdit = new Date().getTime() - lastMoveToEditTime

      if (timeSinceMoveToEdit > TIME_TO_IGNORE_NAVIGATION_AFTER_MOVE_COMMAND) {
        if (currentStepsBack > 0) {
          if (getConfig().logDebug) {
            console.log(
              `Resetting step back history. Time since move to edit command: ${timeSinceMoveToEdit}`,
            )
          }

          if (getConfig().topStackWhenMove)
            moveEditTopStackByIndex(editList.length - currentStepsBack)

          currentStepsBack = 0
        }
      }
    },
  )

  const onConfigChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('navigateEditHistory')) {
      reloadConfig()
    }
  })

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
      // e.contentChanges.forEach((change) =>
      //   addEdit(change.text, change.range, change.rangeLength, e.document),
      // )
      const lastContentChange = e.contentChanges[e.contentChanges.length - 1]
      addEdit(lastContentChange.text, lastContentChange.range, e.document)
    },
  )

  const moveEditTopStackByIndex = (index: number): void => {
    if (index < 0 || index >= editList.length) return
    const edit = editList[index]
    editList.splice(index, 1)
    editList.push(edit)
  }

  const moveEditTopStack = (edit: Edit): void => {
    moveEditTopStackByIndex(editList.indexOf(edit))
  }

  const addEdit = (textChange: string, range: vscode.Range, document: vscode.TextDocument) => {
    // TODO if deleting code, remove edits that were "inside" of them

    const filepath = document.uri.path

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

    const line = range.start.line
    const lineText = document.lineAt(line).text.trim()
    const lastEdit = editList[editList.length - 1] as Edit | undefined
    // Someday maybe we can use "change.range.end" correctly instead of this to determine newlines. But that is currently bugged.
    const changeIsNewline = textChange.startsWith('\n') || textChange.startsWith('\r\n')

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

    const character = range.start.character
    const currentWorkspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filepath))
    // remove workspace path from filepath
    const filename =
      currentWorkspaceFolder !== undefined
        ? filepath.replace(currentWorkspaceFolder.uri.path, '')
        : filepath

    const numberOfNewLines = textChange.match(/\n/g)?.length ?? 0
    const removedLines = range.end.line - range.start.line

    const newEdit = {
      line: line + (changeIsNewline ? 1 : 0),
      character,
      filepath,
      filename,
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
    if (removedLines > 0) {
      editList = editList.map((edit) => {
        if (edit.filepath === newEdit.filepath && edit.line >= newEdit.line) {
          return {
            ...edit,
            line: edit.line - removedLines,
          }
        } else {
          return edit
        }
      })
    }

    // remove duplicate edits, remove if line number and filename are the same
    pruneEditList(newEdit.line, newEdit.filepath)

    if (getConfig().logDebug) {
      console.log(`Saving new edit at line ${newEdit.line} in ${newEdit.filepath}`)
    }
    editList.push(newEdit)

    if (editList.length > getConfig().maxHistorySize) {
      editList.splice(0, 1)
    }

    // save workspace settings, persiste if workspace closes
    saveEdits()
  }

  const moveCursorToNextEdit = (onlyInCurrentFile: boolean) => {
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
    moveCursorToEdit(
      edit,
      getConfig().centerOnReveal
        ? vscode.TextEditorRevealType.InCenterIfOutsideViewport
        : vscode.TextEditorRevealType.Default,
    )
  }

  const moveCursorToLine = async (
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
      // if moving to a new file center, minimizes jurking of cursor
      revealType = vscode.TextEditorRevealType.InCenter
    } else {
      activeEditor = vscode.window.activeTextEditor!
    }

    activeEditor.selection = new vscode.Selection(line, character, line, character)
    const rangeToReveal = new vscode.Range(line, character, line, character)
    activeEditor.revealRange(rangeToReveal, revealType)
  }
  const moveCursorToEdit = async (edit: Edit, revealType: vscode.TextEditorRevealType) => {
    await moveCursorToLine(edit.filepath, edit.line, edit.character, revealType)
  }
  const moveCursorToTopEdit = async () => {
    const edit = editList[editList.length - 1]
    await moveCursorToLine(
      edit.filepath,
      edit.line,
      edit.character,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    )
  }
  // resets cursor to begining of navigation before jumps where made
  const moveCursorCancelNavigation = async () => {
    if (currentStepsBack > 0) {
      await moveCursorToTopEdit()
      currentStepsBack = 0
    }
  }

  const openQuickPickEdits = () => {
    // Add extre edit payload for quickpicker
    type QuickPickEdit = vscode.QuickPickItem & { edit: Edit }

    const editor = vscode.window.activeTextEditor
    const currentLine: number = editor ? editor.selection.active.line : 0
    const currentCharacter: number = editor ? editor.selection.active.character : 0
    const currentFilePath: string = editor ? editor.document.uri.path : ''

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
        moveCursorToEdit(itemT.edit, vscode.TextEditorRevealType.InCenter)
      },
    }

    vscode.window.showQuickPick(items, options).then((selection) => {
      if (typeof selection === 'undefined') {
        // Quick pick canceled, go back to last location
        moveCursorToLine(
          currentFilePath,
          currentLine,
          currentCharacter,
          vscode.TextEditorRevealType.InCenter,
        )
        return
      }
      const itemT = selection
      moveCursorToEdit(itemT.edit, vscode.TextEditorRevealType.InCenter)

      if (getConfig().topStackWhenQuickPickSelect) moveEditTopStack(itemT.edit)
    })
  }
  const isEqualEdit = (e: Edit, line: number, filepath: string): boolean => {
    // if line number and file path are equal
    // reg exp is used to ignore case, important for avoiding duplicates
    return e.line === line && new RegExp(e.filepath, 'i').test(filepath)
  }
  const containsEdit = (line: number, filepath: string): boolean => {
    return editList.some((e) => isEqualEdit(e, line, filepath))
  }
  // filter remove all including duplicates
  const pruneEditList = (line: number, filepath: string): void => {
    editList = editList.filter((e) => !isEqualEdit(e, line, filepath))
  }
  const saveEdits = (): void => {
    context.workspaceState.update('editList', editList)
  }
  const clearEdits = (): void => {
    editList = []
    saveEdits()
  }

  type Command = 'create' | 'remove' | 'toggle' | 'clear'

  const runCommand = (command: Command) => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return

    const position = editor.selection.active
    const lineText = editor.document.lineAt(position.line).text
    const filepath = editor.document.uri.path

    switch (command) {
      case 'create':
        addEdit(lineText, new vscode.Range(position, position), editor.document)
        break
      case 'remove':
        pruneEditList(position.line, filepath)
        break
      case 'toggle':
        containsEdit(position.line, filepath) ? runCommand('remove') : runCommand('create')
        break
      case 'clear':
        clearEdits()
        break

      default:
        break
    }

    currentStepsBack = 0
    saveEdits()
  }

  const gotoEditCommand = vscode.commands.registerCommand(
    'navigateEditHistory.moveCursorToPreviousEdit',
    () => moveCursorToNextEdit(false),
  )
  const gotoEditInCurrentFileCommand = vscode.commands.registerCommand(
    'navigateEditHistory.moveCursorToPreviousEditInCurrentFile',
    () => moveCursorToNextEdit(true),
  )
  const goToTopStackCommand = vscode.commands.registerCommand(
    'navigateEditHistory.moveCursorCancelNavigation',
    () => moveCursorCancelNavigation(),
  )
  const listEditsCommand = vscode.commands.registerCommand('navigateEditHistory.list', () =>
    openQuickPickEdits(),
  )
  const createEditAtCursorCommand = vscode.commands.registerCommand(
    'navigateEditHistory.createEditAtCursor',
    () => runCommand('create'),
  )
  const removeEditAtCursorCommand = vscode.commands.registerCommand(
    'navigateEditHistory.removeEditAtCursor',
    () => runCommand('remove'),
  )
  const toggleEditAtCursorCommand = vscode.commands.registerCommand(
    'navigateEditHistory.toggleEditAtCursor',
    () => runCommand('toggle'),
  )
  const clearCommand = vscode.commands.registerCommand('navigateEditHistory.clearEdits', () =>
    runCommand('clear'),
  )

  context.subscriptions.push(
    gotoEditCommand,
    gotoEditInCurrentFileCommand,
    listEditsCommand,
    createEditAtCursorCommand,
    removeEditAtCursorCommand,
    toggleEditAtCursorCommand,
    clearCommand,
    onDeleteListener,
    goToTopStackCommand,
    selectionDidChangeListener,
    documentChangeListener,
    onConfigChangeListener,
  )
}

export function deactivate(context: vscode.ExtensionContext) {
  //  noting to do here, YET
}
