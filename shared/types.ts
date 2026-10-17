export type DeliveryType = 'package' | 'envelope' | 'pallet' | 'food' | 'flowers' | 'other';

export interface Host {
  id: string;
  fullName: string;
  department?: string;
}

export interface NotificationTarget {
  slackWebhookUrl?: string;
  teamsWebhookUrl?: string;
  slackUserId?: string;
}

export interface VisitorArrival {
  visitorName: string;
  company?: string;
  hostName: string;
  purpose?: string;
  arrivedAt: Date;
  photoUrl?: string;
}

export interface DeliveryArrival {
  carrier: string;
  type: DeliveryType;
  recipientName: string;
  receivedAt: Date;
  photoUrl?: string;
}

/** Email or phone is required (mirrors the visitors_contact_chk DB constraint). */
export interface CheckInInput {
  fullName: string;
  company?: string;
  email?: string;
  phone?: string;
  hostId: string;
  photoBase64?: string;
}

export interface DeliveryInput {
  carrier: string;
  type: DeliveryType;
  recipientId: string;
  photoBase64?: string;
}

export interface KioskApi {
  searchHosts(q: string): Promise<Host[]>;
  checkIn(input: CheckInInput): Promise<{ visitId: string }>;
  scanCheckIn(qrToken: string): Promise<{ visitorName: string; hostName: string }>;
  checkOut(input: { qrToken?: string; visitId?: string }): Promise<void>;
  searchOnSite(q: string): Promise<{ visitId: string; visitorName: string }[]>;
  dropOff(input: DeliveryInput): Promise<{ deliveryId: string }>;
}
