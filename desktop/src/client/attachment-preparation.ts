import type { FileUploadService } from '@deepseek-ai/dsh-client-file-upload/client'
import type { LingPromptAttachment } from 'ling-desktop/runtime'

export function createDshAttachmentPreparation(fileUpload: FileUploadService) {
  return {
    async prepare(taskId: string, attachments: readonly LingPromptAttachment[]) {
      const prepared = await Promise.all(attachments.map(async attachment => {
        if (attachment.kind === 'image') {
          return {
            content: {
              type: 'image' as const,
              mediaType: attachment.mediaType,
              data: attachment.data,
              ...(attachment.name === undefined ? {} : { name: attachment.name }),
            },
            pending: {
              type: 'image' as const,
              value: {
                previewUrl: `data:${attachment.mediaType};base64,${attachment.data}`,
                ...(attachment.name === undefined ? {} : { name: attachment.name }),
                ...(attachment.width === undefined ? {} : { width: attachment.width }),
                ...(attachment.height === undefined ? {} : { height: attachment.height }),
              },
            },
          }
        }

        // Exact bytes take the Remote branch of this service, which the host
        // context cannot reach; a Blob body uses the background HTTP carrier.
        const result = await fileUpload.upload(
          taskId as Parameters<FileUploadService['upload']>[0],
          new Blob([attachment.data]),
          attachment.name,
        )
        if (!result.ok) throw new Error(result.error.message || '文件上传失败。')
        return {
          content: {
            type: 'file' as const,
            receiptId: result.value.receiptId,
          },
          pending: {
            type: 'file' as const,
            value: result.value.file,
          },
        }
      }))

      return {
        content: prepared.map(item => item.content),
        pending: prepared.map(item => item.pending),
      }
    },
  }
}
