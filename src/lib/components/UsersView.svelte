<script lang="ts">
  import { apiFetch } from '$lib/format';
  import type { PublicUser, SessionUser, UserRole } from '$lib/types';

  let { currentUser }: { currentUser: SessionUser } = $props();

  let users = $state<PublicUser[]>([]);
  let newId = $state('');
  let newName = $state('');
  let newRole = $state<UserRole>('user');
  let note = $state('');
  let noteErr = $state(false);
  let busy = $state(false);

  export async function loadUsers() {
    if (currentUser.role !== 'admin') return;
    try {
      const r = await apiFetch<{ users: PublicUser[] }>('GET', '/api/admin/users');
      users = r.users;
    } catch (e) {
      note = (e as Error).message;
      noteErr = true;
    }
  }

  $effect(() => {
    if (currentUser.role === 'admin') {
      loadUsers();
    }
  });

  async function addUser(ev: SubmitEvent) {
    ev.preventDefault();
    const body = { member_id: newId.trim(), full_name: newName.trim(), role: newRole };
    if (!body.member_id || !body.full_name) {
      note = 'Enter both an ID and a name.';
      noteErr = true;
      return;
    }
    busy = true;
    try {
      const r = await apiFetch<{ users: PublicUser[] }>('POST', '/api/admin/users', body);
      users = r.users;
      note = `Added ${body.member_id}. They can now use "First time? Set password".`;
      noteErr = false;
      newId = '';
      newName = '';
    } catch (e) {
      note = (e as Error).message;
      noteErr = true;
    } finally {
      busy = false;
    }
  }

  async function resetUser(u: PublicUser) {
    if (!confirm(`Reset the password of ${u.member_id}? They will create a new one at next sign-in.`)) return;
    try {
      const r = await apiFetch<{ users: PublicUser[] }>(
        'POST',
        `/api/admin/users/${encodeURIComponent(u.member_id)}/reset`
      );
      users = r.users;
      note = `Password reset for ${u.member_id}.`;
      noteErr = false;
    } catch (e) {
      note = (e as Error).message;
      noteErr = true;
    }
  }

  async function deleteUser(u: PublicUser) {
    if (!confirm(`Delete user ${u.member_id} (${u.full_name})? This cannot be undone.`)) return;
    try {
      const r = await apiFetch<{ users: PublicUser[] }>(
        'DELETE',
        `/api/admin/users/${encodeURIComponent(u.member_id)}`
      );
      users = r.users;
      note = `Deleted ${u.member_id}.`;
      noteErr = false;
    } catch (e) {
      note = (e as Error).message;
      noteErr = true;
    }
  }
</script>

<section id="users" class="page-content">
  <div class="page-heading">
    <h1>Users</h1>
    <p>Admins can add and remove accounts. New users create their own password at first sign-in.</p>
  </div>

  <article class="card">
    <h2 class="card-title">Add user</h2>
    <form id="addUserForm" class="inline-form" novalidate onsubmit={addUser}>
      <div>
        <label for="newId">Member ID</label>
        <input id="newId" placeholder="e.g. MOCK-66-0068" bind:value={newId} required />
      </div>
      <div>
        <label for="newName">Full name</label>
        <input id="newName" placeholder="Full name" bind:value={newName} required />
      </div>
      <div>
        <label for="newRole">Permission</label>
        <select id="newRole" bind:value={newRole}>
          <option value="user">Normal user</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button class="btn primary" type="submit" disabled={busy}>Add user</button>
    </form>
    {#if note}
      <p id="userMsg" class="form-note" class:err={noteErr} role="status">{note}</p>
    {/if}
  </article>

  <article class="card table-card">
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Permission</th>
            <th>Status</th>
            <th class="right">Actions</th>
          </tr>
        </thead>
        <tbody id="userRows">
          {#each users as u (u.member_id)}
            {@const self = u.member_id === currentUser.member_id}
            <tr>
              <td>{u.member_id}</td>
              <td>{u.full_name}{self ? ' (you)' : ''}</td>
              <td>
                <span class="badge" class:admin={u.role === 'admin'}>
                  {u.role === 'admin' ? 'Admin' : 'Normal user'}
                </span>
              </td>
              <td>
                <span class={`badge ${u.has_password ? 'ok' : 'wait'}`}>
                  {u.has_password ? 'Active' : 'Waiting for first sign-in'}
                </span>
              </td>
              <td class="right">
                <button class="btn small" type="button" onclick={() => resetUser(u)}>
                  Reset password
                </button>
                <button
                  class="btn small danger"
                  type="button"
                  disabled={self}
                  onclick={() => deleteUser(u)}
                >
                  Delete
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </article>
</section>
