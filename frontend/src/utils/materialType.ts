// One icon per material-type family. COBISS material type codes are two
// characters: record type (a b text, c d music, e f maps, g video, i j sound,
// k graphics, l electronic, m multimedia, r objects) + bibliographic level
// (`s` = serial).

export function materialTypeIcon(code: string | null | undefined): string {
  if (!code) return 'o_description';
  const recordType = code.charAt(0);
  const level = code.charAt(1);
  switch (recordType) {
    case 'a':
    case 'b':
      return level === 's' ? 'o_newspaper' : level === 'a' ? 'o_article' : 'o_menu_book';
    case 'c':
    case 'd':
      return 'o_music_note';
    case 'e':
    case 'f':
      return 'o_map';
    case 'g':
      return 'o_movie';
    case 'i':
    case 'j':
      return 'o_headphones';
    case 'k':
      return 'o_image';
    case 'l':
      return 'o_computer';
    case 'm':
      return 'o_perm_media';
    case 'r':
      return 'o_category';
    default:
      return 'o_description';
  }
}
