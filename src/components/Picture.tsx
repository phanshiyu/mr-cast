import { createContext, useContext } from 'react';
import { ImageOff } from 'lucide-react';
import { Img } from 'remotion';
import type { ImageFit, ImageManifest } from '../types';
import { colors, fonts } from './theme';

/** The run's local copies of its pictures, and the URL prefix they are served under. */
export const ImagesContext = createContext<{ images: ImageManifest; baseUrl?: string }>({ images: {} });

export const useImages = () => useContext(ImagesContext).images;

/**
 * A picture by its `src` as the storyboard writes it, drawn from the run's copy. Without one, as before `validate`
 * has copied it or in a still of a storyboard with no images.json, a placeholder names the source.
 */
export const Picture: React.FC<{ src: string; fit: ImageFit | 'fill'; style?: React.CSSProperties }> = ({ src, fit, style }) => {
  const { images, baseUrl } = useContext(ImagesContext);
  const entry = Object.hasOwn(images, src) ? images[src] : undefined;
  if (!entry || baseUrl === undefined) {
    return (
      <div style={{ ...style, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, boxSizing: 'border-box', border: `2px dashed ${colors.borderStrong}`, borderRadius: 14, color: colors.faint }}>
        <ImageOff size={48} />
        <div style={{ fontFamily: fonts.mono, fontSize: 18, maxWidth: '80%', overflowWrap: 'anywhere', textAlign: 'center' }}>{src}</div>
      </div>
    );
  }
  return <Img src={baseUrl + entry.file} style={{ ...style, objectFit: fit, display: 'block' }} />;
};
