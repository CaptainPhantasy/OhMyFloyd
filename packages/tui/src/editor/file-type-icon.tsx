'use strict'

import React from 'react'
import { Text } from 'ink'

interface FileTypeIconProps {
  path: string
}

export const FileTypeIcon = ({ path }: FileTypeIconProps) => {
  const getIcon = () => {
    if (path.endsWith('.md')) return '📄'
    if (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.js')) return '💻'
    if (path.endsWith('.json')) return '🗃'
    if (path.endsWith('.yaml') || path.endsWith('.yml')) return '📋'
    if (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.gif')) return '🖼'
    if (path.endsWith('.pdf')) return '📕'
    if (path.endsWith('.txt')) return '📝'
    if (path.endsWith('.zip') || path.endsWith('.tar') || path.endsWith('.gz')) return '🗄'
    
    // Check if it's a directory
    if (path.endsWith('/') || !path.includes('.')) return '📁'
    
    return '📄' // Default icon
  }
  
  return <Text>{getIcon()}</Text>
}