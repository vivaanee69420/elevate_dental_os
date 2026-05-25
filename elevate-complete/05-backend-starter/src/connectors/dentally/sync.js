/**
 * Dentally sync workers.
 * TODO: full implementation per DENTALLY_SETUP.md Day 2.
 */
const { makeClient, fetchAllPages } = require('./client');
const { pool } = require('../../config/db');

async function syncTodayAppointments(integrationId) {
  const client = await makeClient(integrationId);
  const today = new Date().toISOString().slice(0, 10);
  const appointments = await fetchAllPages(client, '/v1/appointments', {
    start_time_from: today,
    start_time_to: today
  });
  for (const a of appointments) await upsertAppointment(integrationId, a);
  return appointments.length;
}

async function upsertAppointment(integrationId, a) {
  // TODO: resolve practice_id from integration.config + a.site_id
  // TODO: resolve patient_id, practitioner_id, room_id from external_id mappings
  // Upsert into appointments table per the schema
  throw new Error('upsertAppointment not implemented — see DENTALLY_SETUP.md Day 2');
}

module.exports = { syncTodayAppointments };
