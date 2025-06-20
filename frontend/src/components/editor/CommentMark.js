// CommentMark.js - Simplified and Correct Version

import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';

export const CommentMark = Mark.create({
  name: 'comment',

  addOptions() {
    return {
      HTMLAttributes: {},
      onCommentClick: (commentId) => {},
      // This is the only state it needs, passed in as an option
      activeCommentId: null,
    };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-comment-id'),
        renderHTML: attributes => ({ 'data-comment-id': attributes.commentId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  // This function now correctly reads from `this.options`
  renderHTML({ HTMLAttributes }) {
    const activeId = this.options.activeCommentId;
    const currentId = HTMLAttributes['data-comment-id'];

    let className = 'comment-mark';
    if (currentId && currentId === activeId) {
      className += ' comment-mark-active';
    }

    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: className }), 0];
  },

  addCommands() {
    return {
      setComment: (commentId) => ({ commands }) => commands.setMark(this.name, { commentId }),
      toggleComment: (commentId) => ({ commands }) => commands.toggleMark(this.name, { commentId }),
      unsetComment: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },

  // The click handler is still correct
  addProseMirrorPlugins() {
    const self = this;
    return [
      new Plugin({
        key: new PluginKey('commentClick'),
        props: {
          handleClick: (view, pos, event) => {
            const attrs = self.editor.getAttributes(self.name);
            const commentId = attrs.commentId;
            if (commentId && event.target?.closest('span[data-comment-id]')) {
              self.options.onCommentClick(commentId);
            }
            return false;
          },
        },
      }),
    ];
  },
});

export default CommentMark;