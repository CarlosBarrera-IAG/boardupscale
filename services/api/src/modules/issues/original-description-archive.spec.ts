import {
  ORIGINAL_DESCRIPTION_PRESERVED_MARKER,
  buildOriginalDescriptionArchiveComment,
  shouldArchiveOriginalDescription,
} from './original-description-archive';

describe('original-description-archive', () => {
  describe('shouldArchiveOriginalDescription', () => {
    it('archives when description changes for the first time', () => {
      expect(
        shouldArchiveOriginalDescription('<p>Old</p>', '<p>New</p>', []),
      ).toBe(true);
    });

    it('skips when description is unchanged', () => {
      expect(
        shouldArchiveOriginalDescription('<p>Same</p>', '<p>Same</p>', []),
      ).toBe(false);
    });

    it('skips when there was no prior description content', () => {
      expect(shouldArchiveOriginalDescription(null, '<p>New</p>', [])).toBe(false);
      expect(shouldArchiveOriginalDescription('   ', '<p>New</p>', [])).toBe(false);
    });

    it('skips when already preserved', () => {
      expect(
        shouldArchiveOriginalDescription(
          '<p>Old</p>',
          '<p>New</p>',
          [ORIGINAL_DESCRIPTION_PRESERVED_MARKER],
        ),
      ).toBe(false);
    });

    it('skips when description is not in the update dto', () => {
      expect(shouldArchiveOriginalDescription('<p>Old</p>', undefined, [])).toBe(false);
    });
  });

  describe('buildOriginalDescriptionArchiveComment', () => {
    it('wraps the original html with a heading', () => {
      expect(buildOriginalDescriptionArchiveComment('<p>Body</p>')).toContain('<p>Body</p>');
      expect(buildOriginalDescriptionArchiveComment('<p>Body</p>')).toContain('archived on first edit');
    });
  });
});
