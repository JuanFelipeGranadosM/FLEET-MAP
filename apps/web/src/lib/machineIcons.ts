/* Siluetas laterales por tipo de equipo (SVG 64×64, una sola tinta).
 * Se usan como máscara en deck.gl IconLayer, así el color se aplica por estado. */
const wheel = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`;

const PATHS: Record<string, string> = {
  // Excavadora: orugas, tornamesa con cabina, pluma, brazo y cucharón
  EXC: 'M10 46h26a5 5 0 0 1 0 10H10a5 5 0 0 1 0-10z M6 32h12v-10h10l3 10h5v12H6z M30 33l13-21 5 3-12 21z M43 11l14 14-4 4-13-13z M53 24l8 7-2 9-9-2 2-7z',
  // Volqueta articulada: tolva, cabina, chasis y tres ejes
  VOL: 'M22 16h40l-5 22H22z M3 24h15v14H3z M3 38h58v5H3z ' + wheel(11, 49, 6) + ' ' + wheel(38, 49, 6) + ' ' + wheel(52, 49, 6),
  // Cargador frontal: cucharón, brazos, cabina alta y ruedas grandes
  CAR: 'M2 32l13-4 3 15H5z M15 33l-2-4 12-8 3 4z M20 28h24v14H20z M30 12h13v16H30z M44 30h14v12H44z ' + wheel(26, 48, 8) + ' ' + wheel(50, 48, 8),
  // Bulldozer: hoja frontal, orugas, cabina y ripper
  BUL: 'M2 24h7v28H2z M9 37h8v5H9z M13 44h40a6 6 0 0 1 0 12H13a6 6 0 0 1 0-12z M16 29h34v15H16z M30 14h14v15H30z M50 33h6l3 15h-3l-3-10h-3z',
  // Motoniveladora: bastidor largo, hoja central, cabina trasera
  MOT: 'M4 29h50v5H4z M2 33h8v8H2z M40 12h12v17H40z M48 25h14v14H48z M20 40h18l-3 5H18z ' + wheel(9, 49, 6) + ' ' + wheel(44, 49, 6) + ' ' + wheel(56, 49, 6),
  // Retroexcavadora: pala frontal, cabina, brazo trasero
  RET: 'M2 34l11-3 3 11H5z M13 34l-1-4 6-2 1 4z M16 27h28v15H16z M27 12h12v15H27z M43 30l11-15 4 3-10 15z M54 14l7 10-4 3-7-9z ' + wheel(22, 48, 7) + ' ' + wheel(46, 49, 5),
  // Compactador: rodillo liso delantero, chasis, cabina
  COM: wheel(14, 45, 11) + ' M12 28h40v12H12z M34 11h13v17H34z ' + wheel(49, 48, 8),
  // Grúa móvil: portador, pluma inclinada y gancho
  GRU: 'M3 35h58v9H3z M3 25h11v10H3z M17 33L57 6l3 4-39 27z M57 9h2v19h-2z M55 28h6v3h-6z ' + wheel(11, 49, 5) + ' ' + wheel(23, 49, 5) + ' ' + wheel(43, 49, 5) + ' ' + wheel(54, 49, 5),
};

const cache: Record<string, { url: string; id: string; width: number; height: number; mask: boolean }> = {};
export function machineIcon(typeId: string) {
  return (cache[typeId] ??= {
    id: typeId,
    url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path fill="#fff" fill-rule="nonzero" d="${PATHS[typeId] ?? PATHS.EXC}"/></svg>`),
    width: 64, height: 64, mask: true,
  });
}
export const MACHINE_TYPES = Object.keys(PATHS);
