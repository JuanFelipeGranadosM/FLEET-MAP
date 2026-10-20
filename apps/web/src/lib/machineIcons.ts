/* Iconos isométricos por tipo de equipo (recortados de la lámina del cliente). */
import BUL from '../assets/machines/BUL.png';
import CAR from '../assets/machines/CAR.png';
import COM from '../assets/machines/COM.png';
import EXC from '../assets/machines/EXC.png';
import GRU from '../assets/machines/GRU.png';
import MIN from '../assets/machines/MIN.png';
import MOT from '../assets/machines/MOT.png';
import RET from '../assets/machines/RET.png';
import VOL from '../assets/machines/VOL.png';

// RET (retroexcavadora) usa la excavadora sobre llantas: la lámina no trae retroexcavadora.
const URLS: Record<string, string> = { BUL, CAR, COM, EXC, GRU, MIN, MOT, RET, VOL };

const cache: Record<string, { url: string; id: string; width: number; height: number; mask: boolean; anchorY: number }> = {};
export function machineIcon(typeId: string) {
  return (cache[typeId] ??= { id: typeId, url: URLS[typeId] ?? URLS.EXC, width: 128, height: 128, mask: false, anchorY: 80 });
}
export const machineIconUrl = (typeId: string) => URLS[typeId] ?? URLS.EXC;
