import * as vscode from 'vscode'

interface Config {
  maxSize: number
  centerOnReveal: boolean
  logDebug: boolean
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
  const newConfig = {
    maxSize: config.get<number>('maxHistory') ?? 10,
    centerOnReveal: config.get<boolean>('centerOnReveal') === true,
    logDebug: config.get<boolean>('logDebug') === true,
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
