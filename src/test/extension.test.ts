import * as vscode from 'vscode'
import * as assert from 'assert'

suite('Extension Test Suite', () => {
  void vscode.window.showInformationMessage('Start all tests.')

  test('Sample test', () => {
    assert.equal(3, 3)
  })
})
