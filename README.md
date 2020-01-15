# vscode-navigate-edit-history README

Yet another edit history navigator extension for vscode. Offers a command to go one step further back in edit history. Any navigation or selection will reset the command to once again go to the latest edit. Any edits close to the last edit will be bundled into one edit history item, the closeness can be configured.

This extension is very opinionated. Im happy to take suggestions, but this extension is primarily made to support one specific workflow. You are welcome to fork and publish your own version if you like what I have made!

## Reason to exist

There exists good alternatives to this extension:

[Vscode Edits History](https://github.com/mishkinf/vscode-edits-history)

However, I encountered a few bugs and found it to contain features that I found superfluous. If you miss features in this extension, then maybe Vscode Edits History will have them.

## Known Issues

- Cant save edit history in files that have never been saved to disk.
