export function avatarPathForSelection(existingPath, selectedPreset, presetChanged) {
  if (presetChanged) return `preset:${selectedPreset}`;
  return existingPath || `preset:${selectedPreset}`;
}

export function getAvatarPresentation(avatarPath, publicUrl = '') {
  const path = avatarPath || '';
  if (path.startsWith('preset:')) return { type: 'preset', mark: path.slice('preset:'.length) };
  if (path && publicUrl) return { type: 'image', url: publicUrl };
  return { type: 'initial' };
}
