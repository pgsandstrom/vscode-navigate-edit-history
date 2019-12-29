# vscode-navigate-edit-history README

Yet another edit history navigator extension for vscode. Offers a command to go one step further back in edit history. Any navigation or selection will reset the command to once again go to the latest edit. Any edits close to the last edit will be bundled into one edit history item.

This extension is very opinionated. Im happy to take suggestions, but this extension is primarily made to support one specific workflow. You are welcome to fork and publish your own version if you like what I have made!

## Known Issues

- Cant save edit history in files that have never been saved to disk.

## How to release

Info about releasing extensions: https://code.visualstudio.com/api/working-with-extensions/publishing-extension

Currently I do "vsce package" and upload manually at https://marketplace.visualstudio.com/manage/publishers/codeandstuff
