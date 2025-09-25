import React from 'react';

export const BookmarkFolderMenuItem: React.FC<{
  itemId: string
  itemName: string
  isSelected: boolean
}> = ({
  itemId,
  itemName,
  isSelected,
}) => {
  return (
    <div className="d-flex align-items-center grw-bookmark-folder-menu-item-title">
      <input
        type="radio"
        checked={isSelected}
        name="bookmark-folder-menu-item"
        id={`bookmark-folder-menu-item-${itemId}`}
        onChange={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      />
      <label htmlFor={`bookmark-folder-menu-item-${itemId}`} className="p-2 m-0 form-label text-truncate">
        {itemName}
      </label>
    </div>
  );
};
