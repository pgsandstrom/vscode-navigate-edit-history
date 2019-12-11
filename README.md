# vscode-navigate-edit-history README

Yet another edit history navigator extension for vscode. Offers a command to go one step further back in edit history. Any navigation or selection will reset the command to once again go to the latest edit. Any edits on the same line will be bundled into one edit action.

This extension is currently not very configurable and very opinionated. Im happy to take in suggestions, but this extension is currently only made to fit my personal workflow.

## Extension Settings

There are currently no settings.

## Known Issues

TBA

## Release Notes

### 0.3.0

Should be pretty usable by now! But still not always handling edit history good if a file is heavily edited.

## How to release

Info about releasing extensions: https://code.visualstudio.com/api/working-with-extensions/publishing-extension

Currently I do "vsce package" and upload manually at https://marketplace.visualstudio.com/manage/publishers/codeandstuff
