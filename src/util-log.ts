import { getConfig } from './config'

export function logWrapper(...args: Parameters<typeof console.log>) {
  if (getConfig().logDebug) {
    // eslint-disable-next-line no-console
    console.log(args)
  }
}
