import type { DeliveryInput, DeliveryType } from '../../shared/types';
import { deliveries } from '../db/schema';
import type { Deps } from '../deps';
import { AppError } from '../errors';
import { now, requireActiveUser, safely, storePhoto, targetOf } from './common';

const TYPES: readonly DeliveryType[] = ['package', 'envelope', 'pallet', 'food', 'flowers', 'other'];
const MAX_CARRIER = 60;

export async function dropOff(deps: Deps, input: DeliveryInput): Promise<{ deliveryId: string }> {
  const carrier = input.carrier?.trim();
  if (!carrier || carrier.length > MAX_CARRIER) throw new AppError(400, 'invalid_request', 'Please choose the carrier.');
  if (!TYPES.includes(input.type)) throw new AppError(400, 'invalid_request', 'Please choose the type of item.');

  const recipient = await requireActiveUser(deps.db, input.recipientId, 'That recipient');
  const photo = await storePhoto(deps, 'deliveries', input.photoBase64);
  const receivedAt = now(deps);

  const [row] = await deps.db
    .insert(deliveries)
    .values({ recipientId: recipient.id, carrier, type: input.type, photoUrl: photo?.key ?? null, receivedAt })
    .returning({ id: deliveries.id });

  safely(() =>
    deps.notify.delivery({ carrier, type: input.type, recipientName: recipient.fullName, receivedAt, photoUrl: photo?.url }, targetOf(recipient)),
  );
  return { deliveryId: row!.id };
}
