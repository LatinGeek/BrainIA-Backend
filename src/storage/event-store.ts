import { insertSplitEvent, listStoredEvents } from "./event-repository.js";
import type { ClassifiedEvent } from "../domain/event.js";

export async function ensureStorage() {
  return;
}

export async function appendEvent(event: ClassifiedEvent) {
  return insertSplitEvent(event);
}

export async function listEvents() {
  return listStoredEvents();
}
