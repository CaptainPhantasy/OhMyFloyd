'use strict'

import { describe, it, expect } from '@jest/globals'
import { createEditorIntegration } from '../src/editor/integration'

describe('EditorIntegration', () => {
  it('should create an editor integration instance', () => {
    const onError = (err: Error) => { /* ignore */ }
    const integration = createEditorIntegration('/test/dir', { onError })

    expect(integration).toBeDefined()
    expect(integration.showExplorer).toBe(true)
    expect(integration.editor).toBeDefined()
  })

  it('should toggle explorer visibility', () => {
    const onError = (err: Error) => { /* ignore */ }
    const integration = createEditorIntegration('/test/dir', { onError })

    expect(integration.showExplorer).toBe(true)
    integration.toggleExplorer()
    expect(integration.showExplorer).toBe(false)
    integration.toggleExplorer()
    expect(integration.showExplorer).toBe(true)
  })

  it('should adjust explorer width', () => {
    const onError = (err: Error) => { /* ignore */ }
    const integration = createEditorIntegration('/test/dir', { onError })

    const initialWidth = integration.explorerWidth
    integration.adjustExplorerWidth(10)
    expect(integration.explorerWidth).toBe(initialWidth + 10)

    integration.adjustExplorerWidth(-20)
    expect(integration.explorerWidth).toBe(initialWidth - 10)
  })

  it('should set active view', () => {
    const onError = (err: Error) => { /* ignore */ }
    const integration = createEditorIntegration('/test/dir', { onError })

    expect(integration.activeView).toBe('editor')
    integration.setActiveView('preview')
    expect(integration.activeView).toBe('preview')
    integration.setActiveView('split')
    expect(integration.activeView).toBe('split')
  })
})
