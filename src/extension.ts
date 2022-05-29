import * as vscode from 'vscode'
import { getConfig, reloadConfig } from './config'
import { triggerDecorations, reloadStyleConfig } from './markerStyle'

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

          if (getConfig().topStackWhenMove) {
            moveEditTopStackByIndex(editList.length - currentStepsBack)
          }

          currentStepsBack = 0
        }
      }
    },
  )

  const onConfigChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('navigateEditHistory')) {
      reloadConfig()
      triggerDecorations(context, editList)
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

      // iterate over all changes, necessary to keep old edits line numbers up to date
      e.contentChanges.forEach((change) => addEdit(change.text, change.range, e.document))
    },
  )

  const moveEditTopStackByIndex = (index: number): void => {
    if (index < 0 || index >= editList.length) {
      return
    }
    const edit = editList[index]
    editList.splice(index, 1)
    editList.push(edit)
  }

  const moveEditTopStack = (edit: Edit): void => {
    moveEditTopStackByIndex(editList.indexOf(edit))
  }

  const addEdit = (textChange: string, range: vscode.Range, document: vscode.TextDocument) => {
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

    if (/^[a-zA-Z1-9-]*$/.test(filepath)) {
      if (getConfig().logDebug) {
        console.log(
          `Not adding to edit history since unsaved files are not supported. Path: ${filepath}`,
        )
      }
      return
    }

    // Someday maybe we can use "change.range.end" correctly instead of this to determine newlines. But that is currently bugged.
    const changeIsNewline = textChange.startsWith('\n') || textChange.startsWith('\r\n')
    const line = range.start.line + (changeIsNewline ? 1 : 0)
    const lineText = document.lineAt(line).text.trim()

    const currentWorkspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filepath))
    // remove workspace path from filepath
    const filename =
      currentWorkspaceFolder !== undefined
        ? filepath.replace(currentWorkspaceFolder.uri.path, '')
        : filepath

    const numberOfNewLines = textChange.match(/\n/g)?.length ?? 0
    const removedLines = range.end.line - range.start.line

    // When we delete, we want to return to the start of the deletion
    // When we add, we want to return to the end of the addition
    const isDeletion =
      removedLines > 0 || range.end.character - range.start.character > textChange.length
    const character = isDeletion ? range.start.character : range.end.character + textChange.length

    const lastEdit = editList[editList.length - 1] as Edit | undefined
    const newEdit = {
      line,
      character,
      filepath,
      filename,
      lineText,
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
      // remove edits that where inside deleted range
      editList = editList.filter(
        (edit) => !(edit.line >= range.start.line && edit.line < range.end.line),
      )
      // adjust line numbers of old edits
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
    // save workspace settings, persists when workspace closes
    saveEdits()
    // can add the bookmark
    triggerDecorations(context, editList)
  }

  const moveCursorToPreviousEdit = (onlyInCurrentFile: boolean) => {
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
      // prevent a failed onlyInCurrentFile search from altering currentStepsBack
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

  const moveCursorToNextEdit = (onlyInCurrentFile: boolean) => {
    if (currentStepsBack === 1) {
      if (getConfig().logDebug) {
        console.log('At the start of the edit list, cant go forward any longer')
      }
      return
    }

    const initialCurrentStepBack = currentStepsBack

    const activeFilePath = vscode.window.activeTextEditor?.document.uri.path

    let edit
    while (!edit) {
      currentStepsBack--
      edit = editList[editList.length - currentStepsBack] as Edit | undefined
      if (edit === undefined) {
        if (getConfig().logDebug) {
          console.log('Failed to find next edit')
        }
        // prevent a failed onlyInCurrentFile search from altering currentStepsBack
        currentStepsBack = initialCurrentStepBack
        return
      }
      if (onlyInCurrentFile && activeFilePath !== edit.filepath) {
        console.log(`skipping due to wrong file: ${edit.filepath}`)
        edit = undefined
      }
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
      // if moving to a new file center, minimizes jerking of cursor
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
  // resets cursor to beginning of navigation before jumps where made
  const moveCursorCancelNavigation = async () => {
    if (currentStepsBack > 0) {
      await moveCursorToTopEdit()
      currentStepsBack = 0
    }
  }

  const openQuickPickEdits = () => {
    // Add extra edit payload for quickpicker
    type QuickPickEdit = vscode.QuickPickItem & { edit: Edit }

    const editor = vscode.window.activeTextEditor
    const currentLine: number = editor ? editor.selection.active.line : 0
    const currentCharacter: number = editor ? editor.selection.active.character : 0
    const currentFilePath: string = editor ? editor.document.uri.path : ''

    // push the items
    const items: QuickPickEdit[] = editList
      .map((edit: Edit) => {
        // vscode line numbers start at 1, increment for display
        const description = `(${edit.line + 1})`
        const pick: QuickPickEdit = {
          label: edit.lineText,
          description,
          edit,
        }

        // If not in file add file path to detail
        if (edit.filepath !== currentFilePath) {
          pick.detail = edit.filename
        }

        return pick
      })
      .reverse()

    const options: vscode.QuickPickOptions = {
      placeHolder: 'Type a line number or a piece of code to navigate to',
      matchOnDescription: true,
      matchOnDetail: getConfig().filterOnPathInEditList,
      onDidSelectItem: (item) => {
        const itemT = item as QuickPickEdit
        moveCursorToEdit(itemT.edit, vscode.TextEditorRevealType.InCenter)
      },
    }

    vscode.window.showQuickPick(items, options).then((selection) => {
      if (typeof selection === 'undefined') {
        // Quick pick cancelled, go back to last location
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

      if (getConfig().topStackWhenQuickPickSelect) {
        moveEditTopStack(itemT.edit)
      }
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
    if (!editor) {
      return
    }

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
    triggerDecorations(context, editList)
  }

  const gotoPreviousEditCommand = vscode.commands.registerCommand(
    'navigateEditHistory.moveCursorToPreviousEdit',
    () => moveCursorToPreviousEdit(false),
  )
  const gotoNextEditCommand = vscode.commands.registerCommand(
    'navigateEditHistory.moveCursorToNextEdit',
    () => moveCursorToNextEdit(false),
  )
  const gotoPreviousEditInCurrentFileCommand = vscode.commands.registerCommand(
    'navigateEditHistory.moveCursorToPreviousEditInCurrentFile',
    () => moveCursorToPreviousEdit(true),
  )
  const gotoNextEditInCurrentFileCommand = vscode.commands.registerCommand(
    'navigateEditHistory.moveCursorToNextEditInCurrentFile',
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

  const onActiveTextEditorListener = vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor) {
        //console.log('onDidChangeActiveTextEditor')
        triggerDecorations(context, editList)
      }
    },
    null,
    context.subscriptions,
  )
  reloadStyleConfig()
  triggerDecorations(context, editList)

  context.subscriptions.push(
    gotoPreviousEditCommand,
    gotoNextEditCommand,
    gotoPreviousEditInCurrentFileCommand,
    gotoNextEditInCurrentFileCommand,
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
    onActiveTextEditorListener,
  )
}

export function deactivate(context: vscode.ExtensionContext) {
  //  nothing to do here, YET
}
