import type { Handle } from '@sveltejs/kit';
import '$lib/server/clockfaces';

export const handle: Handle = ({ event, resolve }) => resolve(event);
