import { boolean, customType, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/schema.sql, which remains the source of truth (a test guards against drift). */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const visitStatus = pgEnum('visit_status', ['pre_booked', 'checked_in', 'checked_out', 'cancelled', 'no_show']);
export const deliveryStatus = pgEnum('delivery_status', ['received', 'notified', 'picked_up', 'returned']);
export const deliveryType = pgEnum('delivery_type', ['package', 'envelope', 'pallet', 'food', 'flowers', 'other']);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  email: citext('email').notNull().unique(),
  phone: text('phone'),
  department: text('department'),
  slackWebhookUrl: text('slack_webhook_url'),
  teamsWebhookUrl: text('teams_webhook_url'),
  slackUserId: text('slack_user_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const visitors = pgTable('visitors', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  company: text('company'),
  email: citext('email'),
  phone: text('phone'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const visits = pgTable(
  'visits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitorId: uuid('visitor_id').notNull().references(() => visitors.id, { onDelete: 'restrict' }),
    hostId: uuid('host_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    status: visitStatus('status').notNull().default('pre_booked'),
    qrToken: text('qr_token').notNull().unique(),
    purpose: text('purpose'),
    photoUrl: text('photo_url'),
    expectedAt: ts('expected_at'),
    checkedInAt: ts('checked_in_at'),
    checkedOutAt: ts('checked_out_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_visits_visitor').on(t.visitorId)],
);

export const deliveries = pgTable('deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipientId: uuid('recipient_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  carrier: text('carrier').notNull(),
  type: deliveryType('type').notNull().default('package'),
  status: deliveryStatus('status').notNull().default('received'),
  photoUrl: text('photo_url'),
  notes: text('notes'),
  receivedAt: ts('received_at').notNull().defaultNow(),
  pickedUpAt: ts('picked_up_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
