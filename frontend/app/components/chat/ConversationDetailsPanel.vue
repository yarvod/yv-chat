<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import type { ConversationMediaItem } from '../../application/messaging/conversation-media'
import type {
  Conversation,
  ConversationMember,
  DirectoryUser,
  MessageAttachment,
} from '../../domain/messaging/models'
import AppIcon from '../ui/AppIcon.vue'
import MessageAttachments from './MessageAttachments.vue'

type DetailsTab = 'media' | 'files' | 'members'

const props = withDefaults(defineProps<{
  conversation: Conversation
  directory: readonly DirectoryUser[]
  actorUserId: string
  online: boolean
  busy: boolean
  notice: string | null
  mediaItems: readonly ConversationMediaItem[]
  mediaLoading: boolean
  mediaTruncated: boolean
  reloadMedia: () => Promise<void>
  loadAttachment: (
    conversationId: string,
    attachment: MessageAttachment,
    expiresAt: string,
  ) => Promise<Blob>
  openMessage: (messageId: string) => Promise<void>
  renameGroup: (title: string) => Promise<boolean>
  addMember: (userId: string) => Promise<boolean>
  removeMember: (userId: string) => Promise<boolean>
  leaveGroup: () => Promise<boolean>
  activeAudioTrackId?: string | null
  audioPlaying?: boolean
}>(), {
  activeAudioTrackId: null,
  audioPlaying: false,
})
const emit = defineEmits<{
  close: []
  left: []
  playAudio: [item: ConversationMediaItem, attachment: MessageAttachment]
}>()

const title = ref(props.conversation.title ?? '')
const activeTab = ref<DetailsTab>('media')
const selectedUserId = ref('')
const removeCandidateId = ref<string | null>(null)
const leaveConfirming = ref(false)
const downloadingAttachmentId = ref<string | null>(null)
const downloadNotice = ref<string | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const actor = computed(() => props.conversation.members.find(member => (
  member.userId === props.actorUserId && member.leftAt === null
)) ?? null)
const peer = computed(() => props.conversation.members.find(member => (
  member.userId !== props.actorUserId && member.leftAt === null
)) ?? null)
const displayName = computed(() => props.conversation.conversationType === 'group'
  ? props.conversation.title ?? 'Группа'
  : peer.value?.displayName ?? 'Личный диалог')
const profileSubtitle = computed(() => {
  if (props.conversation.conversationType === 'direct') {
    if (props.online) return 'В сети'
    return 'Личный диалог'
  }
  return `${activeMembers.value.length} ${memberWord(activeMembers.value.length)}`
})
const canManage = computed(() => actor.value?.role === 'owner' || actor.value?.role === 'admin')
const activeMembers = computed(() => props.conversation.members
  .filter(member => member.leftAt === null)
  .slice()
  .sort((left, right) => roleRank(left) - roleRank(right)
    || left.displayName.localeCompare(right.displayName, 'ru')))
const activeMemberIds = computed(() => new Set(activeMembers.value.map(member => member.userId)))
const availableUsers = computed(() => props.directory
  .filter(user => !activeMemberIds.value.has(user.userId))
  .slice()
  .sort((left, right) => left.displayName.localeCompare(right.displayName, 'ru')))
const atMemberLimit = computed(() => activeMembers.value.length >= 50)
const media = computed(() => props.mediaItems.filter(item => item.attachment.kind !== 'file'))
const files = computed(() => props.mediaItems.filter(item => item.attachment.kind === 'file'))
const visibleItems = computed(() => activeTab.value === 'files' ? files.value : media.value)

watch(() => props.conversation.title, value => { title.value = value ?? '' })

onMounted(async () => {
  await nextTick()
  closeButton.value?.focus()
  await props.reloadMedia()
})

function memberWord(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'участников'
  if (mod10 === 1) return 'участник'
  if (mod10 >= 2 && mod10 <= 4) return 'участника'
  return 'участников'
}

function roleRank(member: ConversationMember): number {
  if (member.role === 'owner') return 0
  if (member.role === 'admin') return 1
  return 2
}

function roleLabel(member: ConversationMember): string {
  if (member.role === 'owner') return 'Владелец'
  if (member.role === 'admin') return 'Администратор'
  return 'Участник'
}

function canRemove(member: ConversationMember): boolean {
  if (!canManage.value || member.userId === props.actorUserId || member.role === 'owner') {
    return false
  }
  if (actor.value?.role === 'admin') return member.role === 'member'
  return true
}

function senderName(item: ConversationMediaItem): string {
  return props.conversation.members.find(member => member.userId === item.senderUserId)?.displayName
    ?? 'Участник'
}

function sentAt(item: ConversationMediaItem): string {
  return new Date(item.createdAt).toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} Б`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} КБ`
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} МБ`
}

async function download(item: ConversationMediaItem): Promise<void> {
  if (downloadingAttachmentId.value !== null) return
  downloadingAttachmentId.value = item.attachment.attachmentId
  downloadNotice.value = null
  try {
    const blob = await props.loadAttachment(
      props.conversation.conversationId,
      item.attachment,
      item.expiresAt,
    )
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = item.attachment.name
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  } catch {
    downloadNotice.value = 'Не удалось скачать файл: возможно, срок хранения уже истёк.'
  } finally {
    downloadingAttachmentId.value = null
  }
}

async function goToMessage(messageId: string): Promise<void> {
  await props.openMessage(messageId)
  emit('close')
}

async function submitTitle(): Promise<void> {
  const normalized = title.value.trim()
  if (!normalized || normalized === props.conversation.title) return
  await props.renameGroup(normalized)
}

async function submitMember(): Promise<void> {
  if (!selectedUserId.value || atMemberLimit.value) return
  if (await props.addMember(selectedUserId.value)) selectedUserId.value = ''
}

async function confirmRemove(userId: string): Promise<void> {
  if (await props.removeMember(userId)) removeCandidateId.value = null
}

async function leave(): Promise<void> {
  if (await props.leaveGroup()) {
    emit('left')
    emit('close')
  }
}
</script>

<template>
  <div class="conversation-details-backdrop" role="presentation" @click.self="emit('close')">
    <section
      class="conversation-details-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conversation-details-title"
      @keydown.esc="emit('close')"
    >
      <header class="conversation-details-hero">
        <button
          ref="closeButton"
          class="conversation-details-close"
          type="button"
          aria-label="Закрыть информацию о чате"
          @click="emit('close')"
        >
          <AppIcon name="close" />
        </button>
        <span class="conversation-details-avatar" aria-hidden="true">
          {{ displayName.slice(0, 1).toUpperCase() }}
        </span>
        <h2 id="conversation-details-title">{{ displayName }}</h2>
        <p :class="{ online: online && conversation.conversationType === 'direct' }">
          {{ profileSubtitle }}
        </p>
        <p v-if="conversation.conversationType === 'direct' && peer" class="conversation-details-username">
          @{{ peer.username }}
        </p>
      </header>

      <nav
        class="conversation-details-tabs"
        :class="{ 'conversation-details-tabs--direct': conversation.conversationType === 'direct' }"
        aria-label="Разделы информации о чате"
      >
        <button type="button" :class="{ active: activeTab === 'media' }" @click="activeTab = 'media'">
          <AppIcon name="media" />
          <span>Медиа</span>
          <strong>{{ media.length }}</strong>
        </button>
        <button type="button" :class="{ active: activeTab === 'files' }" @click="activeTab = 'files'">
          <AppIcon name="file" />
          <span>Файлы</span>
          <strong>{{ files.length }}</strong>
        </button>
        <button
          v-if="conversation.conversationType === 'group'"
          type="button"
          :class="{ active: activeTab === 'members' }"
          @click="activeTab = 'members'"
        >
          <AppIcon name="users" />
          <span>Участники</span>
          <strong>{{ activeMembers.length }}</strong>
        </button>
      </nav>

      <div class="conversation-details-scroll">
        <section v-if="activeTab === 'media' || activeTab === 'files'" class="conversation-media-section">
          <div v-if="mediaLoading && mediaItems.length === 0" class="conversation-media-empty" role="status">
            <span class="loading-orbit" aria-hidden="true" />
            <p>Собираем вложения из истории…</p>
          </div>
          <div v-else-if="visibleItems.length === 0" class="conversation-media-empty">
            <AppIcon :name="activeTab === 'files' ? 'file' : 'media'" />
            <h3>{{ activeTab === 'files' ? 'Файлов пока нет' : 'Медиа пока нет' }}</h3>
            <p>Здесь появятся доступные вложения из этой переписки.</p>
          </div>
          <div v-else :class="activeTab === 'media' ? 'conversation-media-grid' : 'conversation-file-list'">
            <article
              v-for="item in visibleItems"
              :key="item.attachment.attachmentId"
              class="conversation-media-card"
              :class="{ 'conversation-media-card--file': item.attachment.kind === 'file' }"
            >
              <MessageAttachments
                :conversation-id="conversation.conversationId"
                :message-id="item.messageId"
                :expires-at="item.expiresAt"
                :attachments="[item.attachment]"
                :load-attachment="loadAttachment"
                :active-audio-track-id="activeAudioTrackId"
                :audio-playing="audioPlaying"
                @play-audio="emit('playAudio', item, $event)"
              />
              <div class="conversation-media-meta">
                <span>
                  <strong>{{ senderName(item) }}</strong>
                  <small>{{ sentAt(item) }} · {{ formatBytes(item.attachment.byteSize) }}</small>
                </span>
                <div>
                  <button type="button" @click="goToMessage(item.messageId)">К сообщению</button>
                  <button
                    type="button"
                    :disabled="downloadingAttachmentId !== null"
                    @click="download(item)"
                  >
                    {{ downloadingAttachmentId === item.attachment.attachmentId ? 'Скачиваем…' : 'Скачать' }}
                  </button>
                </div>
              </div>
            </article>
          </div>
          <p v-if="mediaTruncated" class="conversation-media-limit">
            Показаны вложения из последних 2 000 сообщений в пределах доступной истории.
          </p>
          <p v-if="downloadNotice" class="group-details-notice" role="alert">{{ downloadNotice }}</p>
        </section>

        <template v-else>
          <form v-if="canManage" class="group-title-form" @submit.prevent="submitTitle">
            <label for="group-title">Название</label>
            <div>
              <input id="group-title" v-model="title" maxlength="100" required :disabled="busy">
              <button type="submit" :disabled="busy || !title.trim() || title.trim() === conversation.title">
                Сохранить
              </button>
            </div>
          </form>

          <section class="group-members-section" aria-labelledby="group-members-title">
            <div class="group-section-heading">
              <h3 id="group-members-title">Участники</h3>
              <span>{{ activeMembers.length }}/50</span>
            </div>

            <form v-if="canManage && availableUsers.length > 0" class="group-add-member" @submit.prevent="submitMember">
              <label class="sr-only" for="group-add-user">Добавить участника</label>
              <select id="group-add-user" v-model="selectedUserId" :disabled="busy || atMemberLimit">
                <option value="">Добавить человека…</option>
                <option v-for="user in availableUsers" :key="user.userId" :value="user.userId">
                  {{ user.displayName }} · @{{ user.username }}
                </option>
              </select>
              <button type="submit" :disabled="busy || atMemberLimit || !selectedUserId">Добавить</button>
            </form>
            <p v-else-if="canManage && atMemberLimit" class="group-limit-note">Достигнут лимит в 50 участников.</p>

            <ul class="group-member-list">
              <li v-for="member in activeMembers" :key="member.userId">
                <span class="conversation-avatar">{{ member.displayName.slice(0, 1).toUpperCase() }}</span>
                <span class="group-member-copy">
                  <strong>{{ member.displayName }}<em v-if="member.userId === actorUserId"> · вы</em></strong>
                  <small>@{{ member.username }} · {{ roleLabel(member) }}</small>
                </span>
                <div v-if="canRemove(member)" class="group-member-actions">
                  <template v-if="removeCandidateId === member.userId">
                    <button type="button" :disabled="busy" class="danger" @click="confirmRemove(member.userId)">Удалить</button>
                    <button type="button" :disabled="busy" @click="removeCandidateId = null">Нет</button>
                  </template>
                  <button v-else type="button" :disabled="busy" @click="removeCandidateId = member.userId">
                    Убрать
                  </button>
                </div>
              </li>
            </ul>
          </section>

          <p v-if="notice" class="group-details-notice" role="alert">{{ notice }}</p>
          <div v-if="actor?.role !== 'owner'" class="group-leave-zone">
            <template v-if="leaveConfirming">
              <p>После выхода история перестанет синхронизироваться на этом аккаунте.</p>
              <div>
                <button type="button" class="group-leave-button" :disabled="busy" @click="leave">Да, покинуть</button>
                <button type="button" :disabled="busy" @click="leaveConfirming = false">Отмена</button>
              </div>
            </template>
            <button v-else type="button" class="group-leave-button" :disabled="busy" @click="leaveConfirming = true">
              Покинуть группу
            </button>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>
