import * as vscode from 'vscode'

interface Config {
  markerStyle?: string
  markerWholeLine?: boolean
  markerColor?: string
  markerJSON?: MyDecorationRenderOptions // will auto generate
  markerJSONCustom?: MyDecorationRenderOptions
}
interface Edit {
  line: number
  character: number
  filepath: string
  filename: string
  lineText: string
}

let globalConfig: Config = {}
let context: vscode.ExtensionContext
let editList: Edit[]

export const reloadStyleConfig = () => {
  //console.log('reloadStyleConfig')
  const config = vscode.workspace.getConfiguration('navigateEditHistory')
  const newConfig: Config = {
    markerStyle: config.get<string>('markerStyle'),
    markerWholeLine: config.get<boolean>('markerWholeLine'),
    markerColor: config.get('markerColor'),
    markerJSONCustom: config.get('markerJSONCustom'),
  }
  newConfig.markerJSON = generateJSON(newConfig)
  globalConfig = newConfig
  //console.log('globalConfig:'+ JSON.stringify(globalConfig) );
}
function generateJSON(conf: Config): MyDecorationRenderOptions {
  //  show in overview 默认在右侧缩略图中显示
  let objDecoration: MyDecorationRenderOptions = {
    overviewRulerColor: '#AA000099', // RGBA
    overviewRulerLane: 2, // Center: 2 Full: 7 Left: 1 Right: 4
  } //isWholeLine: true
  objDecoration = Object.assign(objDecoration, { isWholeLine: conf.markerWholeLine })
  const config = vscode.workspace.getConfiguration('navigateEditHistory')
  type StringKey = Record<string, object>
  const decoraList: StringKey = {
    leftRect: {
      border: '1px',
      borderStyle: 'none none none solid',
      borderColor: conf.markerColor,
    },
    leftDash: {
      border: '1px',
      borderStyle: 'none none none dashed',
      borderColor: conf.markerColor,
    },
    leftDot: {
      border: '1px',
      borderStyle: 'none none none dotted',
      borderColor: conf.markerColor,
    },
    bottomDot: {
      border: '2px',
      borderStyle: 'none none dotted none',
      borderRadius: '15px',
      borderColor: conf.markerColor,
    },
    background: {
      backgroundColor: conf.markerColor,
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'SVG rectangle': {
      gutterIconPathExt: './img/rectangle.svg', // defined myself for relative path
      gutterIconSize: 'auto',
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'SVG triangle': {
      gutterIconPathExt: './img/triangle.svg', // defined myself for relative path
      gutterIconSize: 'auto',
    },
    custom: <object>conf.markerJSONCustom,
  }
  let style = conf.markerStyle
  if (style === undefined) {
    style = 'leftRect'
  }
  const newDecroa = decoraList[style]
  Object.assign(objDecoration, newDecroa)
  config.update('markerJSON', objDecoration, true) // https://code.visualstudio.com/api/references/vscode-api#WorkspaceConfiguration
  return objDecoration
}
// add new key
interface MyDecorationRenderOptions extends vscode.DecorationRenderOptions {
  gutterIconPathExt?: 'string'
}

function showMarker(ct: vscode.ExtensionContext, path: string, editArr: Edit[]) {
  const win = vscode.window
  if (globalConfig.markerJSON === undefined) {
    return
  }
  if (globalConfig.markerStyle === 'none') {
    return
  }
  // copy a new  Decoration
  const objDecoration: vscode.DecorationRenderOptions = { ...globalConfig.markerJSON } //isWholeLine: true
  //console.log( ' --- globalConfig:'+JSON.stringify(globalConfig.markerJSON) )
  const svgPath = globalConfig.markerJSON.gutterIconPathExt || ''
  if (svgPath === '') {
    delete objDecoration.gutterIconPath
  } else {
    if (svgPath.indexOf('./') === 0) {
      // relative path
      objDecoration.gutterIconPath = ct.asAbsolutePath(svgPath)
    } else {
      objDecoration.gutterIconPath = svgPath
    }
  }
  //console.log( ' --- globalConfig:'+JSON.stringify(globalConfig.markerJSON) )
  const myDecoration = win.createTextEditorDecorationType(objDecoration)
  //console.log('objDecoration:' + JSON.stringify(objDecoration) );
  if (win.activeTextEditor === undefined) {
    win.showInformationMessage('Error , No editor!!!')
    return
  }
  const editor = win.activeTextEditor
  const rangeArr: vscode.Range[] = []
  for (const v of editArr) {
    if (path === v.filepath) {
      rangeArr.push(new vscode.Range(v.line, 0, v.line, v.character))
    }
  }
  editor.setDecorations(myDecoration, rangeArr)
}
let timeout: NodeJS.Timer | undefined = undefined

function updateDecorations() {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    return
  }
  // use global var
  showMarker(context, editor.document.uri.path, editList)
}
export function triggerDecorations(ct: vscode.ExtensionContext, el: Edit[]) {
  context = ct
  editList = el
  //console.log('triggerUpdateDecorations')
  if (timeout) {
    clearTimeout(timeout)
    timeout = undefined
  }
  timeout = setTimeout(updateDecorations, 10)
}
