import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Box, ButtonGroup, IconButton, Tooltip, Divider } from '@mui/material';
import {
    FormatBold,
    FormatItalic,
    FormatUnderlined,
    FormatListBulleted,
    FormatListNumbered,
    FormatAlignLeft,
    FormatAlignCenter,
    FormatAlignRight,
    FormatClear,
    AddLink,
    FormatColorText
} from '@mui/icons-material';

interface RichTextEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

export interface RichTextEditorHandle {
    insertAtCursor: (text: string) => void;
}

const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
    ({ value, onChange, placeholder }, ref) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const savedRangeRef = useRef<Range | null>(null);

    // Save the current cursor position whenever selection changes inside the editor
    const saveCursorPosition = useCallback(() => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            // Only save if the selection is inside our editor
            if (editorRef.current && editorRef.current.contains(range.commonAncestorContainer)) {
                savedRangeRef.current = range.cloneRange();
            }
        }
    }, []);

    // Expose insertAtCursor method to parent via ref
    useImperativeHandle(ref, () => ({
        insertAtCursor: (text: string) => {
            const editor = editorRef.current;
            if (!editor) return;

            // Focus the editor first
            editor.focus();

            // Restore saved cursor position if available
            const sel = window.getSelection();
            if (sel && savedRangeRef.current) {
                sel.removeAllRanges();
                sel.addRange(savedRangeRef.current);
            }

            // Insert the text at cursor position using insertText command
            document.execCommand('insertText', false, text);

            // Update the saved range after insertion
            if (sel && sel.rangeCount > 0) {
                savedRangeRef.current = sel.getRangeAt(0).cloneRange();
            }

            // Notify parent of the change
            onChange(editor.innerHTML);
        }
    }), [onChange]);

    // Synchronize external value with editor content (only on mount)
    useEffect(() => {
        if (editorRef.current && editorRef.current.innerHTML !== value) {
            editorRef.current.innerHTML = value;
        }
    }, []);

    // Listen for selection changes to track cursor position
    useEffect(() => {
        const handleSelectionChange = () => {
            saveCursorPosition();
        };
        document.addEventListener('selectionchange', handleSelectionChange);
        return () => document.removeEventListener('selectionchange', handleSelectionChange);
    }, [saveCursorPosition]);

    const execCommand = (command: string, value: string | undefined = undefined) => {
        document.execCommand(command, false, value);
        if (editorRef.current) {
            onChange(editorRef.current.innerHTML);
            saveCursorPosition();
        }
    };

    const handleInput = () => {
        if (editorRef.current) {
            onChange(editorRef.current.innerHTML);
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
    };

    const handleMouseUp = () => saveCursorPosition();
    const handleKeyUp = () => saveCursorPosition();

    return (
        <Box sx={{ 
            minWidth: 0,
            width: '100%',
            maxWidth: '100%',
            border: '1px solid var(--surface-border)', 
            borderRadius: '20px', 
            overflow: 'hidden',
            bgcolor: 'white',
            boxShadow: 'var(--shadow-sm)'
        }}>
            {/* Toolbar */}
            <Box sx={{ 
                p: 1.25, 
                bgcolor: '#f8fbff', 
                borderBottom: '1px solid var(--surface-border)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
                alignItems: 'center'
            }}>
                <ButtonGroup size="small" variant="text">
                    <Tooltip title="Bold (Ctrl+B)"><IconButton size="small" onClick={() => execCommand('bold')}><FormatBold fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Italic (Ctrl+I)"><IconButton size="small" onClick={() => execCommand('italic')}><FormatItalic fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Underline (Ctrl+U)"><IconButton size="small" onClick={() => execCommand('underline')}><FormatUnderlined fontSize="small" /></IconButton></Tooltip>
                </ButtonGroup>

                <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

                <ButtonGroup size="small" variant="text">
                    <Tooltip title="Bullet List"><IconButton size="small" onClick={() => execCommand('insertUnorderedList')}><FormatListBulleted fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Numbered List"><IconButton size="small" onClick={() => execCommand('insertOrderedList')}><FormatListNumbered fontSize="small" /></IconButton></Tooltip>
                </ButtonGroup>

                <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

                <ButtonGroup size="small" variant="text">
                    <Tooltip title="Align Left"><IconButton size="small" onClick={() => execCommand('justifyLeft')}><FormatAlignLeft fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Align Center"><IconButton size="small" onClick={() => execCommand('justifyCenter')}><FormatAlignCenter fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Align Right"><IconButton size="small" onClick={() => execCommand('justifyRight')}><FormatAlignRight fontSize="small" /></IconButton></Tooltip>
                </ButtonGroup>

                <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

                <ButtonGroup size="small" variant="text">
                    <Tooltip title="Text Color"><IconButton size="small" onClick={() => {
                        const color = prompt('Enter a color (hex or name):', '#6366f1');
                        if (color) execCommand('foreColor', color);
                    }}><FormatColorText fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Insert Link"><IconButton size="small" onClick={() => {
                        const url = prompt('Enter the URL:');
                        if (url) execCommand('createLink', url);
                    }}><AddLink fontSize="small" /></IconButton></Tooltip>
                </ButtonGroup>

                <Box sx={{ flexGrow: 1 }} />

                <Tooltip title="Clear Formatting"><IconButton size="small" onClick={() => execCommand('removeFormat')}><FormatClear fontSize="small" color="error" /></IconButton></Tooltip>
            </Box>

            {/* Editor Area */}
            <Box 
                ref={editorRef}
                contentEditable
                onInput={handleInput}
                onPaste={handlePaste}
                onMouseUp={handleMouseUp}
                onKeyUp={handleKeyUp}
                sx={{ 
                    minWidth: 0,
                    width: '100%',
                    maxWidth: '100%',
                    p: 2.5, 
                    minHeight: '400px', 
                    maxHeight: '600px',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    outline: 'none',
                    fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
                    fontSize: '0.95rem',
                    lineHeight: 1.6,
                    color: '#314155',
                    bgcolor: '#ffffff',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                    '&:empty:before': {
                        content: `attr(data-placeholder)`,
                        color: 'var(--text-muted)',
                        pointerEvents: 'none'
                    },
                    '& *': {
                        maxWidth: '100%',
                    },
                    '& img': {
                        height: 'auto',
                        display: 'block',
                    },
                    '& table': {
                        width: '100% !important',
                        tableLayout: 'fixed',
                        display: 'block',
                        overflowX: 'auto',
                    },
                    '& td, & th': {
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                    },
                    '& a': {
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                    },
                    '& li': { mb: 0.5 }
                }}
                data-placeholder={placeholder || "Start writing your personalized message..."}
            />
        </Box>
    );
});

RichTextEditor.displayName = 'RichTextEditor';
export default RichTextEditor;
