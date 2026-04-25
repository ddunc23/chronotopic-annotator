import { useEffect, useMemo, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Mark, mergeAttributes } from '@tiptap/core'
import { GraphCanvas, lightTheme } from 'reagraph'
import './App.css'

const RELATIONS = ['direct', 'jump', 'indirect']

const ANNOTATION_STYLES = {
  topos: 'background: rgba(170, 59, 255, 0.18); border-bottom: 2px solid rgba(170, 59, 255, 0.7); padding-bottom: 1px;',
  character: 'background: rgba(49, 142, 255, 0.15); border-bottom: 2px solid rgba(49, 142, 255, 0.7); padding-bottom: 1px;',
  unknown: 'background: rgba(180, 180, 180, 0.2); border-bottom: 2px solid #aaa; padding-bottom: 1px;',
}

const AnnotationMark = Mark.create({
  name: 'annotation',
  inclusive: false,
  addAttributes() {
    return {
      annotationType: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-annotation-type'),
        renderHTML: (attributes) => ({
          'data-annotation-type': attributes.annotationType,
        }),
      },
      annotationId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-annotation-id'),
        renderHTML: (attributes) => ({
          'data-annotation-id': attributes.annotationId,
        }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-annotation-type][data-annotation-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    const annotationType = HTMLAttributes['data-annotation-type'] || 'unknown'
    const style = ANNOTATION_STYLES[annotationType] ?? ANNOTATION_STYLES.unknown
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: `annotation annotation-${annotationType}`,
        style,
      }),
      0,
    ]
  },
})

function getSelectionAnnotation(activeEditor) {
  const { state } = activeEditor
  const { from, to, $from } = state.selection

  const inMarks = (marks) => marks.find((mark) => mark.type.name === 'annotation')
  let annotationMark = from === to ? inMarks($from.marks()) : null

  if (!annotationMark) {
    state.doc.nodesBetween(from, to, (node) => {
      if (annotationMark || !node.isText) {
        return
      }
      annotationMark = inMarks(node.marks)
    })
  }

  if (!annotationMark) {
    return null
  }

  return {
    annotationType: annotationMark.attrs.annotationType,
    annotationId: annotationMark.attrs.annotationId,
  }
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function getAnnotationMarksInRange(doc, from, to) {
  const marks = []

  doc.nodesBetween(from, to, (node, position) => {
    if (!node.isText || !node.text) {
      return
    }

    node.marks
      .filter((mark) => mark.type.name === 'annotation')
      .forEach((mark) => {
        marks.push({
          from: position,
          to: position + node.text.length,
          text: node.text,
          attrs: mark.attrs,
        })
      })
  })

  return marks
}

function App() {
  const [chapterName, setChapterName] = useState('I')
  const [topoi, setTopoi] = useState([])
  const [anchors, setAnchors] = useState([])
  const [characters, setCharacters] = useState([])
  const [characterAnchors, setCharacterAnchors] = useState([])
  const [connections, setConnections] = useState([])
  const [framenameInput, setFramenameInput] = useState('')
  const [typeInput, setTypeInput] = useState('encounter')
  const [characterIdInput, setCharacterIdInput] = useState('')
  const [characterLabelInput, setCharacterLabelInput] = useState('')
  const [sourceToposId, setSourceToposId] = useState('')
  const [targetToposId, setTargetToposId] = useState('')
  const [relationInput, setRelationInput] = useState('direct')
  const [selectionSnapshot, setSelectionSnapshot] = useState(null)
  const [activeAnnotation, setActiveAnnotation] = useState(null)
  const [annotationForm, setAnnotationForm] = useState({
    framename: '',
    type: '',
    id: '',
    label: '',
  })
  const [debugState, setDebugState] = useState({
    lastAction: 'idle',
    selection: null,
    activeAnnotation: null,
    writeAttempt: null,
  })
  const [copyState, setCopyState] = useState('idle')

  const editor = useEditor({
    extensions: [StarterKit, AnnotationMark],
    content:
      '<p>Paste or write your chapter text here, then highlight passages to assign topoi.</p>',
    onSelectionUpdate: ({ editor: activeEditor }) => {
      const { from, to } = activeEditor.state.selection
      const currentActiveAnnotation = getSelectionAnnotation(activeEditor)
      setActiveAnnotation(currentActiveAnnotation)

      if (from === to) {
        setSelectionSnapshot(null)
        setDebugState((previous) => ({
          ...previous,
          lastAction: 'selection-cleared',
          selection: { from, to, quote: '' },
          activeAnnotation: currentActiveAnnotation,
        }))
        return
      }
      const quote = activeEditor.state.doc.textBetween(from, to, ' ').trim()
      if (!quote) {
        setSelectionSnapshot(null)
        setDebugState((previous) => ({
          ...previous,
          lastAction: 'empty-selection',
          selection: { from, to, quote: '' },
          activeAnnotation: currentActiveAnnotation,
        }))
        return
      }
      setSelectionSnapshot({ from, to, quote })
      setDebugState((previous) => ({
        ...previous,
        lastAction: 'selection-updated',
        selection: { from, to, quote },
        activeAnnotation: currentActiveAnnotation,
      }))
    },
  })

  const topoiById = useMemo(() => {
    return new Map(topoi.map((topos) => [topos.id, topos]))
  }, [topoi])

  const charactersById = useMemo(() => {
    return new Map(characters.map((character) => [character.id, character]))
  }, [characters])

  const implicitCharacterTopoiLinks = useMemo(() => {
    const pairs = new Map()

    anchors.forEach((toposAnchor) => {
      characterAnchors.forEach((characterAnchor) => {
        const isInsideTopos =
          characterAnchor.chapterId === toposAnchor.chapterId &&
          characterAnchor.from >= toposAnchor.from &&
          characterAnchor.to <= toposAnchor.to

        if (!isInsideTopos) {
          return
        }

        const key = `${characterAnchor.characterId}::${toposAnchor.toposId}`
        if (!pairs.has(key)) {
          pairs.set(key, {
            characterId: characterAnchor.characterId,
            toposId: toposAnchor.toposId,
          })
        }
      })
    })

    return [...pairs.values()]
  }, [anchors, characterAnchors])

  const graphData = useMemo(() => {
    const nodes = [
      ...topoi.map((topos) => ({
        id: `topos:${topos.id}`,
        label: topos.framename,
        fill: 'rgba(170, 59, 255, 0.7)',
      })),
      ...characters.map((character) => ({
        id: `character:${character.id}`,
        label: character.label || character.id,
        fill: 'rgba(99, 160, 255, 0.7)',
      })),
    ]

    const edges = [
      ...connections.map((connection) => ({
        id: connection.id,
        source: `topos:${connection.sourceToposId}`,
        target: `topos:${connection.targetToposId}`,
        label: connection.relation,
      })),
      ...implicitCharacterTopoiLinks.map((link) => ({
        id: `implicit:${link.characterId}:${link.toposId}`,
        source: `character:${link.characterId}`,
        target: `topos:${link.toposId}`,
        label: 'in-topos',
      })),
    ]

    return { nodes, edges }
  }, [characters, connections, implicitCharacterTopoiLinks, topoi])

  const activeAnnotationContext = useMemo(() => {
    if (!activeAnnotation) {
      return null
    }

    if (activeAnnotation.annotationType === 'topos') {
      const anchor = anchors.find((item) => item.id === activeAnnotation.annotationId)
      if (!anchor) {
        return null
      }
      const topos = topoiById.get(anchor.toposId)
      if (!topos) {
        return null
      }
      return {
        annotationType: 'topos',
        anchor,
        topos,
      }
    }

    if (activeAnnotation.annotationType === 'character') {
      const anchor = characterAnchors.find((item) => item.id === activeAnnotation.annotationId)
      if (!anchor) {
        return null
      }
      const character = charactersById.get(anchor.characterId)
      if (!character) {
        return null
      }
      return {
        annotationType: 'character',
        anchor,
        character,
      }
    }

    return null
  }, [activeAnnotation, anchors, characterAnchors, charactersById, topoiById])

  useEffect(() => {
    if (!activeAnnotationContext) {
      setAnnotationForm({ framename: '', type: '', id: '', label: '' })
      return
    }

    if (activeAnnotationContext.annotationType === 'topos') {
      setAnnotationForm({
        framename: activeAnnotationContext.topos.framename,
        type: activeAnnotationContext.topos.type,
        id: '',
        label: '',
      })
      return
    }

    setAnnotationForm({
      framename: '',
      type: '',
      id: activeAnnotationContext.character.id,
      label: activeAnnotationContext.character.label,
    })
  }, [activeAnnotationContext])

  const xmlPreview = useMemo(() => {
    const textBetween = (from, to) => {
      if (!editor) {
        return ''
      }
      return editor.state.doc.textBetween(from, to, '\n')
    }

    const nestedCharacterIds = new Set()

    const toposBlocks = anchors
      .map((anchor) => {
        const topos = topoiById.get(anchor.toposId)
        if (!topos) {
          return null
        }

        const enclosedCharacters = characterAnchors
          .filter(
            (characterAnchor) =>
              characterAnchor.chapterId === anchor.chapterId &&
              characterAnchor.from >= anchor.from &&
              characterAnchor.to <= anchor.to,
          )
          .sort((left, right) => left.from - right.from)

        let body = ''
        let cursor = anchor.from

        enclosedCharacters.forEach((characterAnchor) => {
          const character = charactersById.get(characterAnchor.characterId)
          if (!character || characterAnchor.from < cursor) {
            return
          }

          nestedCharacterIds.add(characterAnchor.id)
          body += escapeXml(textBetween(cursor, characterAnchor.from))
          const labelAttribute = character.label
            ? ` label="${escapeXml(character.label)}"`
            : ''
          body += `<character id="${escapeXml(character.id)}"${labelAttribute}>${escapeXml(
            textBetween(characterAnchor.from, characterAnchor.to),
          )}</character>`
          cursor = characterAnchor.to
        })

        body += escapeXml(textBetween(cursor, anchor.to))

        return {
          from: anchor.from,
          xml: [
            `    <topos framename="${escapeXml(topos.framename)}" type="${escapeXml(topos.type)}">`,
            `${body}`,
            '    </topos>',
          ].join('\n'),
        }
      })
      .filter(Boolean)

    const characterBlocks = characterAnchors
      .map((anchor) => {
        if (nestedCharacterIds.has(anchor.id)) {
          return null
        }
        const character = charactersById.get(anchor.characterId)
        if (!character) {
          return null
        }
        const labelAttribute = character.label
          ? ` label="${escapeXml(character.label)}"`
          : ''
        return {
          from: anchor.from,
          xml: [
            `    <character id="${escapeXml(character.id)}"${labelAttribute}>`,
            `${escapeXml(anchor.quote)}`,
            '    </character>',
          ].join('\n'),
        }
      })
      .filter(Boolean)

    const chapterBlocks = [...toposBlocks, ...characterBlocks]
      .sort((left, right) => left.from - right.from)
      .map((block) => block.xml)

    const connectionBlocks = connections.map((connection) => {
      const source = topoiById.get(connection.sourceToposId)
      const target = topoiById.get(connection.targetToposId)
      if (!source || !target) {
        return ''
      }
      return `  <connection source="${escapeXml(source.framename)}" target="${escapeXml(target.framename)}" relation="${escapeXml(connection.relation)}"></connection>`
    })

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<document>',
      `  <chapter name="${escapeXml(chapterName)}">`,
      ...chapterBlocks,
      '  </chapter>',
      ...connectionBlocks,
      '</document>',
    ]
      .filter(Boolean)
      .join('\n')
  }, [anchors, chapterName, characterAnchors, charactersById, connections, editor, topoiById])

  function downloadXml() {
    const normalizedChapter = chapterName.trim().replaceAll(/\s+/g, '-') || 'chapter'
    const blob = new Blob([xmlPreview], { type: 'application/xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${normalizedChapter}.xml`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  async function copyXml() {
    try {
      await navigator.clipboard.writeText(xmlPreview)
      setCopyState('copied')
      window.setTimeout(() => {
        setCopyState('idle')
      }, 1500)
    } catch {
      setCopyState('error')
      window.setTimeout(() => {
        setCopyState('idle')
      }, 2000)
    }
  }

  function applyAnnotationMark(from, to, annotationType, annotationId) {
    if (!editor || from >= to) {
      setDebugState((previous) => ({
        ...previous,
        lastAction: 'apply-skipped',
        writeAttempt: {
          from,
          to,
          annotationType,
          annotationId,
          success: false,
          reason: 'invalid-editor-or-range',
        },
      }))
      return false
    }

    const { state, view } = editor
    const markType = state.schema.marks.annotation

    if (!markType) {
      setDebugState((previous) => ({
        ...previous,
        lastAction: 'apply-skipped',
        writeAttempt: {
          from,
          to,
          annotationType,
          annotationId,
          success: false,
          reason: 'mark-type-missing',
        },
      }))
      return false
    }

    const transaction = state.tr
    transaction.addMark(
      from,
      to,
      markType.create({
        annotationType,
        annotationId,
      }),
    )
    view.dispatch(transaction)
    editor.commands.focus()

    const marksAfter = getAnnotationMarksInRange(editor.state.doc, from, to)
    const htmlAfter = editor.getHTML()

    setDebugState((previous) => ({
      ...previous,
      lastAction: 'apply-attempted',
      activeAnnotation: {
        annotationType,
        annotationId,
      },
      writeAttempt: {
        from,
        to,
        annotationType,
        annotationId,
        success: true,
        rangeText: editor.state.doc.textBetween(from, to, ' '),
        marksFound: marksAfter,
        htmlContainsAnnotationId: htmlAfter.includes(`data-annotation-id="${annotationId}"`),
        htmlContainsAnnotationType: htmlAfter.includes(
          `data-annotation-type="${annotationType}"`,
        ),
      },
    }))

    return true
  }

  function addToposFromSelection() {
    if (!editor || !selectionSnapshot) {
      return
    }

    const trimmedFramename = framenameInput.trim()
    if (!trimmedFramename) {
      return
    }

    const existingTopos = topoi.find(
      (topos) => topos.framename.toLowerCase() === trimmedFramename.toLowerCase(),
    )
    const toposId = existingTopos?.id ?? crypto.randomUUID()

    if (!existingTopos) {
      setTopoi((previousTopoi) => [
        ...previousTopoi,
        {
          id: toposId,
          framename: trimmedFramename,
          type: typeInput.trim() || 'encounter',
        },
      ])
    }

    const annotationId = crypto.randomUUID()

    setAnchors((previousAnchors) => [
      ...previousAnchors,
      {
        id: annotationId,
        toposId,
        chapterId: chapterName,
        from: selectionSnapshot.from,
        to: selectionSnapshot.to,
        quote: selectionSnapshot.quote,
      },
    ])

    applyAnnotationMark(selectionSnapshot.from, selectionSnapshot.to, 'topos', annotationId)

    setSelectionSnapshot(null)
  }

  function addCharacterFromSelection() {
    if (!editor || !selectionSnapshot) {
      return
    }

    const trimmedCharacterId = characterIdInput.trim()
    if (!trimmedCharacterId) {
      return
    }

    const existingCharacter = characters.find(
      (character) => character.id.toLowerCase() === trimmedCharacterId.toLowerCase(),
    )
    const stableCharacterId = existingCharacter?.id ?? trimmedCharacterId

    if (!existingCharacter) {
      setCharacters((previousCharacters) => [
        ...previousCharacters,
        {
          id: stableCharacterId,
          label: characterLabelInput.trim(),
        },
      ])
    }

    const annotationId = crypto.randomUUID()

    setCharacterAnchors((previousAnchors) => [
      ...previousAnchors,
      {
        id: annotationId,
        characterId: stableCharacterId,
        chapterId: chapterName,
        from: selectionSnapshot.from,
        to: selectionSnapshot.to,
        quote: selectionSnapshot.quote,
      },
    ])

    applyAnnotationMark(selectionSnapshot.from, selectionSnapshot.to, 'character', annotationId)

    setSelectionSnapshot(null)
  }

  function addConnection() {
    if (!sourceToposId || !targetToposId || !relationInput) {
      return
    }

    setConnections((previousConnections) => {
      const duplicate = previousConnections.find(
        (connection) =>
          connection.sourceToposId === sourceToposId &&
          connection.targetToposId === targetToposId &&
          connection.relation === relationInput,
      )

      if (duplicate) {
        return previousConnections
      }

      return [
        ...previousConnections,
        {
          id: crypto.randomUUID(),
          sourceToposId,
          targetToposId,
          relation: relationInput,
        },
      ]
    })
  }

  function saveAnnotationEdits() {
    if (!activeAnnotationContext) {
      return
    }

    if (activeAnnotationContext.annotationType === 'topos') {
      const updatedFramename = annotationForm.framename.trim()
      if (!updatedFramename) {
        return
      }

      setTopoi((previousTopoi) =>
        previousTopoi.map((topos) => {
          if (topos.id !== activeAnnotationContext.topos.id) {
            return topos
          }
          return {
            ...topos,
            framename: updatedFramename,
            type: annotationForm.type.trim() || 'encounter',
          }
        }),
      )
      return
    }

    const updatedCharacterId = annotationForm.id.trim()
    if (!updatedCharacterId) {
      return
    }

    const previousCharacterId = activeAnnotationContext.character.id
    const existingCharacterWithNewId = charactersById.get(updatedCharacterId)
    const renamingToDifferentCharacter =
      existingCharacterWithNewId && existingCharacterWithNewId.id !== previousCharacterId

    if (renamingToDifferentCharacter) {
      setCharacterAnchors((previousAnchors) =>
        previousAnchors.map((anchor) => {
          if (anchor.characterId !== previousCharacterId) {
            return anchor
          }
          return {
            ...anchor,
            characterId: updatedCharacterId,
          }
        }),
      )
      setCharacters((previousCharacters) =>
        previousCharacters
          .map((character) => {
            if (character.id === updatedCharacterId) {
              return {
                ...character,
                label: annotationForm.label.trim(),
              }
            }
            return character
          })
          .filter((character) => character.id !== previousCharacterId),
      )
      return
    }

    setCharacters((previousCharacters) =>
      previousCharacters.map((character) => {
        if (character.id !== previousCharacterId) {
          return character
        }
        return {
          ...character,
          id: updatedCharacterId,
          label: annotationForm.label.trim(),
        }
      }),
    )

    if (updatedCharacterId !== previousCharacterId) {
      setCharacterAnchors((previousAnchors) =>
        previousAnchors.map((anchor) => {
          if (anchor.characterId !== previousCharacterId) {
            return anchor
          }
          return {
            ...anchor,
            characterId: updatedCharacterId,
          }
        }),
      )
    }
  }

  function removeActiveAnnotation() {
    if (!editor || !activeAnnotationContext || !activeAnnotation) {
      return
    }

    editor
      .chain()
      .focus()
      .extendMarkRange('annotation', {
        annotationType: activeAnnotation.annotationType,
        annotationId: activeAnnotation.annotationId,
      })
      .unsetMark('annotation')
      .run()

    if (activeAnnotationContext.annotationType === 'topos') {
      const removedAnchor = activeAnnotationContext.anchor

      setAnchors((previousAnchors) =>
        previousAnchors.filter((anchor) => anchor.id !== activeAnnotation.annotationId),
      )

      const toposStillUsed = anchors.some(
        (anchor) =>
          anchor.id !== activeAnnotation.annotationId && anchor.toposId === removedAnchor.toposId,
      )

      if (!toposStillUsed) {
        setTopoi((previousTopoi) =>
          previousTopoi.filter((topos) => topos.id !== removedAnchor.toposId),
        )
        setConnections((previousConnections) =>
          previousConnections.filter(
            (connection) =>
              connection.sourceToposId !== removedAnchor.toposId &&
              connection.targetToposId !== removedAnchor.toposId,
          ),
        )
      }
    } else {
      const removedAnchor = activeAnnotationContext.anchor

      setCharacterAnchors((previousAnchors) =>
        previousAnchors.filter((anchor) => anchor.id !== activeAnnotation.annotationId),
      )

      const characterStillUsed = characterAnchors.some(
        (anchor) =>
          anchor.id !== activeAnnotation.annotationId &&
          anchor.characterId === removedAnchor.characterId,
      )

      if (!characterStillUsed) {
        setCharacters((previousCharacters) =>
          previousCharacters.filter((character) => character.id !== removedAnchor.characterId),
        )
      }
    }

    setActiveAnnotation(null)
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Chrontopic Annotator (MVP)</h1>
          <p>Highlight text, tag topoi and characters, and character-topos links are inferred by containment.</p>
        </div>
        <label className="chapter-input">
          Chapter
          <input
            value={chapterName}
            onChange={(event) => setChapterName(event.target.value)}
            type="text"
          />
        </label>
      </header>

      <section className="workspace-grid">
        <div className="editor-column">
          <article className="editor-pane">
            <h2>Text</h2>
            <EditorContent editor={editor} className="editor-content" />
          </article>

          <section className="graph-panel">
            <div className="graph-header-row">
              <h2>Graph Preview</h2>
              <p>
                {graphData.nodes.length} nodes · {graphData.edges.length} edges
              </p>
            </div>
            {graphData.nodes.length === 0 ? (
              <p className="selection-preview">Add topoi or characters to generate the graph.</p>
            ) : (
              <div className="graph-canvas-container">
                <GraphCanvas
                  nodes={graphData.nodes}
                  edges={graphData.edges}
                  layoutType="forceDirected2d"
                  draggable
                  labelType="all"
                  theme={{
                    ...lightTheme,
                    canvas: { background: 'transparent', fog: 'transparent' },
                  }}
                />
              </div>
            )}
          </section>
        </div>

        <aside className="sidebar-pane">
          <section className="panel">
            <h2>Create topos from highlight</h2>
            <p className="selection-preview">
              {selectionSnapshot
                ? `Selected: “${selectionSnapshot.quote.slice(0, 120)}${selectionSnapshot.quote.length > 120 ? '…' : ''}”`
                : 'Highlight text in the editor to enable annotation.'}
            </p>
            <label>
              Framename
              <input
                value={framenameInput}
                onChange={(event) => setFramenameInput(event.target.value)}
                type="text"
                placeholder="Wedding"
              />
            </label>
            <label>
              Type
              <input
                value={typeInput}
                onChange={(event) => setTypeInput(event.target.value)}
                type="text"
                placeholder="encounter"
              />
            </label>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={addToposFromSelection}
              disabled={!selectionSnapshot || !framenameInput.trim()}
            >
              Add Topos Anchor
            </button>
          </section>

          <section className="panel">
            <h2>Create character from highlight</h2>
            <label>
              Character ID
              <input
                value={characterIdInput}
                onChange={(event) => setCharacterIdInput(event.target.value)}
                type="text"
                placeholder="mariner"
              />
            </label>
            <label>
              Label (optional)
              <input
                value={characterLabelInput}
                onChange={(event) => setCharacterLabelInput(event.target.value)}
                type="text"
                placeholder="Ancient Mariner"
              />
            </label>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={addCharacterFromSelection}
              disabled={!selectionSnapshot || !characterIdInput.trim()}
            >
              Add Character Anchor
            </button>
            <p className="selection-preview">
              Character topos links are implicit when character highlights sit inside topos highlights.
            </p>
          </section>

          <section className="panel">
            <h2>Selected Annotation</h2>
            {!activeAnnotationContext ? (
              <p className="selection-preview">Click annotated text to edit or remove it.</p>
            ) : (
              <>
                <p className="selection-preview">
                  {activeAnnotationContext.annotationType === 'topos'
                    ? `Topos anchor: “${activeAnnotationContext.anchor.quote.slice(0, 120)}${activeAnnotationContext.anchor.quote.length > 120 ? '…' : ''}”`
                    : `Character anchor: “${activeAnnotationContext.anchor.quote.slice(0, 120)}${activeAnnotationContext.anchor.quote.length > 120 ? '…' : ''}”`}
                </p>
                {activeAnnotationContext.annotationType === 'topos' ? (
                  <>
                    <label>
                      Framename
                      <input
                        value={annotationForm.framename}
                        onChange={(event) =>
                          setAnnotationForm((previous) => ({
                            ...previous,
                            framename: event.target.value,
                          }))
                        }
                        type="text"
                      />
                    </label>
                    <label>
                      Type
                      <input
                        value={annotationForm.type}
                        onChange={(event) =>
                          setAnnotationForm((previous) => ({
                            ...previous,
                            type: event.target.value,
                          }))
                        }
                        type="text"
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Character ID
                      <input
                        value={annotationForm.id}
                        onChange={(event) =>
                          setAnnotationForm((previous) => ({
                            ...previous,
                            id: event.target.value,
                          }))
                        }
                        type="text"
                      />
                    </label>
                    <label>
                      Label (optional)
                      <input
                        value={annotationForm.label}
                        onChange={(event) =>
                          setAnnotationForm((previous) => ({
                            ...previous,
                            label: event.target.value,
                          }))
                        }
                        type="text"
                      />
                    </label>
                  </>
                )}
                <div className="annotation-actions">
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={saveAnnotationEdits}
                  >
                    Save Annotation
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={removeActiveAnnotation}
                  >
                    Remove Annotation
                  </button>
                </div>
              </>
            )}
          </section>

          <section className="panel debug-panel">
            <h2>Debug</h2>
            <pre>
              {JSON.stringify(
                {
                  selectionSnapshot,
                  activeAnnotation,
                  debugState,
                },
                null,
                2,
              )}
            </pre>
          </section>

          <section className="panel">
            <h2>Topoi</h2>
            <ul>
              {topoi.map((topos) => {
                const anchorCount = anchors.filter((anchor) => anchor.toposId === topos.id).length
                return (
                  <li key={topos.id}>
                    <strong>{topos.framename}</strong> ({topos.type}) · {anchorCount} anchor
                    {anchorCount === 1 ? '' : 's'}
                  </li>
                )
              })}
              {topoi.length === 0 ? <li>No topoi added yet.</li> : null}
            </ul>
          </section>

          <section className="panel">
            <h2>Characters</h2>
            <ul>
              {characters.map((character) => {
                const anchorCount = characterAnchors.filter(
                  (anchor) => anchor.characterId === character.id,
                ).length
                return (
                  <li key={character.id}>
                    <strong>{character.id}</strong>
                    {character.label ? ` (${character.label})` : ''} · {anchorCount} anchor
                    {anchorCount === 1 ? '' : 's'}
                  </li>
                )
              })}
              {characters.length === 0 ? <li>No characters added yet.</li> : null}
            </ul>
          </section>

          <section className="panel">
            <h2>Connections</h2>
            <label>
              Source
              <select value={sourceToposId} onChange={(event) => setSourceToposId(event.target.value)}>
                <option value="">Select source</option>
                {topoi.map((topos) => (
                  <option key={topos.id} value={topos.id}>
                    {topos.framename}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Target
              <select value={targetToposId} onChange={(event) => setTargetToposId(event.target.value)}>
                <option value="">Select target</option>
                {topoi.map((topos) => (
                  <option key={topos.id} value={topos.id}>
                    {topos.framename}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Relation
              <select value={relationInput} onChange={(event) => setRelationInput(event.target.value)}>
                {RELATIONS.map((relation) => (
                  <option key={relation} value={relation}>
                    {relation}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={addConnection} disabled={!sourceToposId || !targetToposId}>
              Add Connection
            </button>
            <ul>
              {connections.map((connection) => {
                const source = topoiById.get(connection.sourceToposId)?.framename ?? 'Unknown'
                const target = topoiById.get(connection.targetToposId)?.framename ?? 'Unknown'
                return (
                  <li key={connection.id}>
                    {source} → {target} ({connection.relation})
                  </li>
                )
              })}
              {connections.length === 0 ? <li>No connections added yet.</li> : null}
            </ul>
          </section>
        </aside>
      </section>

      <section className="xml-panel">
        <div className="xml-header">
          <h2>XML Preview</h2>
          <div className="xml-actions">
            <button type="button" onClick={copyXml}>
              Copy XML
            </button>
            <button type="button" onClick={downloadXml}>
              Download XML
            </button>
          </div>
        </div>
        <p className="copy-state" aria-live="polite">
          {copyState === 'copied' ? 'Copied to clipboard.' : null}
          {copyState === 'error' ? 'Copy failed. Clipboard permission may be blocked.' : null}
        </p>
        <pre>{xmlPreview}</pre>
      </section>
    </main>
  )
}

export default App
