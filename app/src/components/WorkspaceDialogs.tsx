import { ConflictModal } from './ConflictModal'
import { ConfirmDialog } from './ConfirmDialog'
import { DocConversationHistoryDialog } from '../modules/ai/ui/DocConversationHistoryDialog'
import { GlobalMemoryDialog } from '../modules/ai/ui/GlobalMemoryDialog'
import { AiChatDialog } from '../modules/ai/ui/AiChatDialog'

export type WorkspaceDialogsProps = {
    conflictError: any
    setConflictError: (err: any) => void
    onRetrySave: () => Promise<void>
    confirmDialog: any
    setConfirmDialog: (dialog: any) => void
    quitConfirmDialog: any
    setQuitConfirmDialog: (dialog: any) => void
    aiChatMode: 'floating' | 'docked'
    aiChatOpen: boolean
    aiChatState: any
    closeAiChatDialog: () => void
    filePath: string | null
    docHistoryState: { open: boolean; docPath: string | null }
    closeDocHistoryDialog: () => void
    globalMemoryState: { open: boolean; initialTab: 'persona' | 'manage' }
    closeGlobalMemoryDialog: () => void
}

export function WorkspaceDialogs(props: WorkspaceDialogsProps) {
    const {
        conflictError,
        setConflictError,
        onRetrySave,
        confirmDialog,
        setConfirmDialog,
        quitConfirmDialog,
        setQuitConfirmDialog,
        aiChatMode,
        aiChatOpen,
        aiChatState,
        closeAiChatDialog,
        filePath,
        docHistoryState,
        closeDocHistoryDialog,
        globalMemoryState,
        closeGlobalMemoryDialog,
    } = props

    return (
        <>
            {conflictError && (
                <ConflictModal
                    error={conflictError}
                    onRetrySave={onRetrySave}
                    onCancel={() => setConflictError(null)}
                />
            )}

            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    cancelText={confirmDialog.cancelText}
                    extraText={confirmDialog.extraText}
                    variant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onExtra={confirmDialog.onExtra}
                    onCancel={() => setConfirmDialog(null)}
                />
            )}

            {quitConfirmDialog && (
                <ConfirmDialog
                    title={quitConfirmDialog.unsavedCount === 1 ? 'Save changes?' : `Save ${quitConfirmDialog.unsavedCount} files?`}
                    message="Your changes will be lost."
                    confirmText="Save All"
                    cancelText="Cancel"
                    extraText="Don't Save"
                    variant="stacked"
                    onConfirm={quitConfirmDialog.onSaveAll}
                    onExtra={quitConfirmDialog.onQuitWithoutSaving}
                    onCancel={() => setQuitConfirmDialog(null)}
                />
            )}

            {aiChatMode === 'floating' && aiChatOpen && aiChatState?.open && (
                <AiChatDialog
                    open={aiChatOpen}
                    entryMode={aiChatState.entryMode}
                    initialContext={aiChatState.initialContext}
                    onClose={closeAiChatDialog}
                    currentFilePath={filePath}
                    tabId={aiChatState.tabId}
                />
            )}

            {docHistoryState.open && docHistoryState.docPath && (
                <DocConversationHistoryDialog
                    open={docHistoryState.open}
                    docPath={docHistoryState.docPath}
                    onClose={closeDocHistoryDialog}
                />
            )}

            {globalMemoryState.open && (
                <GlobalMemoryDialog
                    open={globalMemoryState.open}
                    initialTab={globalMemoryState.initialTab}
                    onClose={closeGlobalMemoryDialog}
                />
            )}
        </>
    )
}
