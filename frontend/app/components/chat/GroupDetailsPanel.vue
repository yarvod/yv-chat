<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import type { Conversation, ConversationMember, DirectoryUser } from '../../domain/messaging/models'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{
  conversation: Conversation
  directory: readonly DirectoryUser[]
  actorUserId: string
  busy: boolean
  notice: string | null
  renameGroup: (title: string) => Promise<boolean>
  addMember: (userId: string) => Promise<boolean>
  removeMember: (userId: string) => Promise<boolean>
  leaveGroup: () => Promise<boolean>
}>()
const emit = defineEmits<{ close: []; left: [] }>()

const title = ref(props.conversation.title ?? '')
const selectedUserId = ref('')
const removeCandidateId = ref<string | null>(null)
const leaveConfirming = ref(false)
const closeButton = ref<HTMLButtonElement | null>(null)
const actor = computed(() => props.conversation.members.find(member => (
  member.userId === props.actorUserId && member.leftAt === null
)) ?? null)
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

watch(() => props.conversation.title, value => { title.value = value ?? '' })

onMounted(async () => {
  await nextTick()
  closeButton.value?.focus()
})

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
  <div class="group-details-backdrop" role="presentation" @click.self="emit('close')">
    <section class="group-details-panel" role="dialog" aria-modal="true" aria-labelledby="group-details-title" @keydown.esc="emit('close')">
      <header class="group-details-header">
        <div>
          <small>Информация о группе</small>
          <h2 id="group-details-title">{{ conversation.title }}</h2>
        </div>
        <button ref="closeButton" type="button" aria-label="Закрыть информацию о группе" @click="emit('close')">
          <AppIcon name="close" />
        </button>
      </header>

      <div class="group-details-scroll">
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
      </div>
    </section>
  </div>
</template>
