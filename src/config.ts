import * as vscode from 'vscode'

interface Config {
  maxHistorySize: number
  centerOnReveal: boolean
  groupEditsWithinLines: number
  logDebug: boolean
  ignoreTimeDuration: number
}

let currentConfig: Config | undefined

export const getConfig = (): Config => {
  if (currentConfig === undefined) {
    reloadConfig()
  }
  return currentConfig as Config
}

export const reloadConfig = () => {
  const config = vscode.workspace.getConfiguration('navigateEditHistory')
  const newConfig: Config = {
    maxHistorySize: config.get<number>('maxHistorySize') as number,
    centerOnReveal: config.get<boolean>('centerOnReveal') === true,
    groupEditsWithinLines: config.get<number>('groupEditsWithinLines') as number,
    logDebug: config.get<boolean>('logDebug') === true,
    ignoreTimeDuration: config.get<number>('ignoreTimeDuration') as number,
  }

  if (currentConfig !== undefined && currentConfig.logDebug !== newConfig.logDebug) {
    if (newConfig.logDebug === true) {
      console.log('Enabling logging')
    } else {
      console.log('Disabling logging')
    }
  }

  currentConfig = newConfig
}
