import type { IAttachmentHasId } from '@growi/core';
import type { Property } from 'csstype';
import React, { type JSX, useCallback } from 'react';

// import Carousel, { Modal, ModalGateway } from 'react-images';

import type { RefsContext } from './util/refs-context';

type Props = {
  attachments: IAttachmentHasId[];
  refsContext: RefsContext;
};

/**
 *  1. when 'fileFormat' is image, render Attachment as an image
 *  2. when 'fileFormat' is not image, render Attachment as an Attachment component
 */
// TODO https://redmine.weseek.co.jp/issues/121095: implement image carousel modal without using react-images
export const ExtractedAttachments = React.memo(
  ({ attachments, refsContext }: Props): JSX.Element => {
    // const [showCarousel, setShowCarousel] = useState(false);
    // const [currentIndex, setCurrentIndex] = useState<number | null>(null);

    // const imageClickedHandler = useCallback((index: number) => {
    //   setShowCarousel(true);
    //   setCurrentIndex(index);
    // }, []);

    const getAttachmentsFilteredByFormat = useCallback(() => {
      return attachments.filter((attachment) =>
        attachment.fileFormat.startsWith('image/'),
      );
    }, [attachments]);

    const getClassesAndStylesForNonGrid = useCallback(() => {
      const { options } = refsContext;

      const width = options?.width;
      const height = options?.height;
      const maxWidth = options?.maxWidth;
      const maxHeight = options?.maxHeight;
      const display = options?.display || 'block';

      const containerStyles = {
        width,
        height,
        maxWidth,
        maxHeight,
        display,
      };

      const imageClasses = [];
      const imageStyles = {
        width,
        height,
        maxWidth,
        maxHeight,
      };

      return {
        containerStyles,
        imageClasses,
        imageStyles,
      };
    }, [refsContext]);

    const getClassesAndStylesForGrid = useCallback(() => {
      const { options } = refsContext;

      const maxWidth = options?.maxWidth;
      const maxHeight = options?.maxHeight;

      const containerStyles = {
        width: refsContext.getOptGridWidth(),
        height: refsContext.getOptGridHeight(),
        maxWidth,
        maxHeight,
      };

      const imageClasses = ['w-100', 'h-100'];
      const imageStyles = {
        objectFit: 'cover' as Property.ObjectFit,
        maxWidth,
        maxHeight,
      };

      return {
        containerStyles,
        imageClasses,
        imageStyles,
      };
    }, [refsContext]);

    /**
     * wrapper method for getClassesAndStylesForGrid/getClassesAndStylesForNonGrid
     */
    const getClassesAndStyles = useCallback(() => {
      const { options } = refsContext;

      return options?.grid != null
        ? getClassesAndStylesForGrid()
        : getClassesAndStylesForNonGrid();
    }, [
      getClassesAndStylesForGrid,
      getClassesAndStylesForNonGrid,
      refsContext,
    ]);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const renderExtractedImage = useCallback(
      (attachment: IAttachmentHasId, _index: number) => {
        const { options } = refsContext;

        // determine alt
        let alt = refsContext.isSingle ? options?.alt : undefined; // use only when single mode
        alt = alt || attachment.originalName; //                     use 'originalName' if options.alt is not specified

        // get styles
        const { containerStyles, imageClasses, imageStyles } =
          getClassesAndStyles();

        // carousel settings
        // let onClick;
        // if (options?.noCarousel == null) {
        //   // pointer cursor
        //   Object.assign(containerStyles, { cursor: 'pointer' });
        //   // set click handler
        //   onClick = () => {
        //     imageClickedHandler(index);
        //   };
        // }

        return (
          <div key={attachment._id} style={containerStyles}>
            <img
              src={attachment.filePathProxied}
              alt={alt}
              className={imageClasses.join(' ')}
              style={imageStyles}
            />
          </div>
        );
      },
      [getClassesAndStyles, refsContext],
    );

    // const renderCarousel = useCallback(() => {
    //   const { options } = refsContext;
    //   const withCarousel = options?.noCarousel == null;

    //   const images = getAttachmentsFilteredByFormat()
    //     .map((attachment) => {
    //       return { src: attachment.filePathProxied };
    //     });

    //   // overwrite react-images modal styles
    //   const zIndex = 1030; // > grw-navbar
    //   const modalStyles = {
    //     blanket: (styleObj) => {
    //       return Object.assign(styleObj, { zIndex });
    //     },
    //     positioner: (styleObj) => {
    //       return Object.assign(styleObj, { zIndex });
    //     },
    //   };

    //   return (
    //     <ModalGateway>
    //       { withCarousel && showCarousel && (
    //         <Modal styles={modalStyles} onClose={() => { setShowCarousel(false) }}>
    //           <Carousel views={images} currentIndex={currentIndex} />
    //         </Modal>
    //       ) }
    //     </ModalGateway>
    //   );
    // }, [refsContext]);

    const { options } = refsContext;
    const grid = options?.grid;
    const gridGap = options?.gridGap;

    const styles = {};

    // Grid mode
    if (grid != null) {
      const gridTemplateColumns = refsContext.isOptGridColumnEnabled()
        ? `repeat(${refsContext.getOptGridColumnsNum()}, 1fr)`
        : `repeat(auto-fill, ${refsContext.getOptGridWidth()})`;

      Object.assign(styles, {
        display: 'grid',
        gridTemplateColumns,
        gridAutoRows: '1fr',
        gridGap,
      });
    }

    const contents = getAttachmentsFilteredByFormat().map((attachment, index) =>
      renderExtractedImage(attachment, index),
    );

    return (
      <React.Fragment>
        <div style={styles}>{contents}</div>

        {/* { renderCarousel() } */}
      </React.Fragment>
    );
  },
);
