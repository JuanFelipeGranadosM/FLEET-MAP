/* Iconos isométricos por tipo de equipo (recortados de la lámina del cliente).
 * Van embebidos (?inline) para que deck.gl no dependa de pedirlos por red. */
import BUL from '../assets/machines/BUL.png?inline';
import CAR from '../assets/machines/CAR.png?inline';
import COM from '../assets/machines/COM.png?inline';
import EXC from '../assets/machines/EXC.png?inline';
import GRU from '../assets/machines/GRU.png?inline';
import MIN from '../assets/machines/MIN.png?inline';
import MOT from '../assets/machines/MOT.png?inline';
import RET from '../assets/machines/RET.png?inline';
import VOL from '../assets/machines/VOL.png?inline';

// RET (retroexcavadora) usa la excavadora sobre llantas: la lámina no trae retroexcavadora.
const URLS: Record<string, string> = { BUL, CAR, COM, EXC, GRU, MIN, MOT, RET, VOL };

/** Clave de icono del equipo: la que mande el servidor, o el tipo si coincide con una lámina; null = sin icono. */
export const iconKey = (eq: { icon?: string | null; typeId: string }) => (eq.icon && URLS[eq.icon] ? eq.icon : URLS[eq.typeId] ? eq.typeId : null);

const cache: Record<string, { url: string; id: string; width: number; height: number; mask: boolean; anchorY: number }> = {};
export function machineIcon(key: string) {
  return (cache[key] ??= { id: key, url: URLS[key] ?? URLS.EXC, width: 128, height: 128, mask: false, anchorY: 80 });
}
export const machineIconUrl = (key: string | null) => (key ? URLS[key] : null);
