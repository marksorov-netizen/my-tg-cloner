import asyncio
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np
from core.watermark_cleaner import WatermarkCleaner


class WatermarkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cleaner = WatermarkCleaner()
        self.cleaner.output_dir = self.tmp.name
        self.image = np.full((800, 600, 3), (130, 145, 160), np.uint8)
        cv2.rectangle(self.image, (480, 690), (585, 730), (155, 115, 220), -1)
        cv2.putText(self.image, 'VELVET', (485, 715), cv2.FONT_HERSHEY_SIMPLEX, .5, (255,255,255), 1)
        self.source = str(Path(self.tmp.name) / 'source.png')
        cv2.imwrite(self.source, self.image)

    def test_clean_alias_without_brand_removes_stamp_and_preserves_other_pixels(self):
        before = Path(self.source).read_bytes()
        mask = self.cleaner._auto_detect_watermark_mask(self.image)
        self.assertGreater(cv2.countNonZero(mask), 0)
        result = self.cleaner.clean_image(self.source, mode='clean', brand_text=None)
        self.assertNotEqual(result, self.source)
        out = cv2.imread(result)
        np.testing.assert_array_equal(out[mask == 0], self.image[mask == 0])
        self.assertLess(np.mean(np.abs(out[695:720,490:575].astype(float)-self.image[695:720,490:575])), 100)
        self.assertFalse(np.array_equal(out[mask != 0], self.image[mask != 0]))
        self.assertEqual(Path(self.source).read_bytes(), before)

    def test_plain_photo_not_changed(self):
        plain = np.full((800,600,3), (30,80,160), np.uint8)
        self.assertEqual(cv2.countNonZero(self.cleaner._auto_detect_watermark_mask(plain)), 0)

    def test_outputs_unique(self):
        first = self.cleaner.clean_image(self.source, mode='clean', brand_text=None)
        second = self.cleaner.clean_image(self.source, mode='clean', brand_text=None)
        self.assertNotEqual(first, second)
        self.assertEqual(cv2.imread(first).shape, self.image.shape)

    def test_media_batch_supports_clean_and_keeps_non_images(self):
        result = asyncio.run(self.cleaner.process_post_media([self.source, 'video.mp4'], mode='clean'))
        self.assertNotEqual(result[0], self.source)
        self.assertEqual(result[1], 'video.mp4')


if __name__ == '__main__':
    unittest.main()
