import * as vscode from 'vscode'
interface Edit {
  line: number
  character: number
  filepath: string
  filename: string
  lineText: string
}

export function showMarker(context: vscode.ExtensionContext, editArr: Edit[]) {
  const win = vscode.window
  let obj: vscode.DecorationRenderOptions = { isWholeLine: true } //isWholeLine: true
  /*
		{
			border: '1px',
  borderStyle: 'solid', borderStyle: 'dashed',
  borderColor: '#fff'
		}
		{
			backgroundColor: '#ff0'
		}
		{
  textDecoration:'underline red'
		}
		let obj2 = Object.assign(obj,{
			overviewRulerColor:'#AA00FF', // 右侧缩略图的标记
			overviewRulerLane :1 // Center: 2 Full: 7 Left: 1 Right: 4  会覆盖
		})
		gutterIconPath : context.asAbsolutePath(`./img/${type}.svg`),
		gutterIconSize : gutterConfig.size
		*/
  console.log(context.asAbsolutePath(`./img/add.svg`))
  obj = Object.assign(obj, {
    border: '1px',
    borderStyle: 'dashed',
    borderColor: '#fff',
    //gutterIconPath : context.asAbsolutePath(`./img/add.svg`), // will conflict with breakpoint https://github.com/Microsoft/vscode/issues/5923
    //gutterIconSize :'auto',
    overviewRulerColor: '#AA000099', // RGBA
    overviewRulerLane: 2, // Center: 2 Full: 7 Left: 1 Right: 4
  })

  const smallNumDecoration = win.createTextEditorDecorationType(obj)
  //const smallNumDecoration2 =  win.createTextEditorDecorationType(obj2)
  if (win.activeTextEditor === undefined) {
    win.showInformationMessage('Error , No editor!!!')
    return
  }
  const editor = win.activeTextEditor
  const rangeArr: vscode.Range[] = []
  for (const v of editArr) {
    rangeArr.push(new vscode.Range(v.line, 0, v.line, 2))
  }
  editor.setDecorations(smallNumDecoration, rangeArr)
}
