import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';

export const CommentMark = Mark.create({
  name: 'comment',

  addOptions() {
    return {
      HTMLAttributes: {},
      onCommentClick: () => {},
    };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-comment-id'),
        renderHTML: attributes => {
          if (!attributes.commentId) {
            return {};
          }
          return { 'data-comment-id': attributes.commentId };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-comment-id]',
        getAttrs: element => !!element.getAttribute('data-comment-id').trim() && null,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setComment: (commentId) => ({ commands }) => {
        if (!commentId) {
          return commands.unsetMark(this.name);
        }
        return commands.setMark(this.name, { commentId });
      },
      toggleComment: (commentId) => ({ commands }) => {
        return commands.toggleMark(this.name, { commentId });
      },
      unsetComment: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('commentClick'),
        props: {
          handleClick: (view, pos, event) => {
            const { schema } = view.state;
            const attrs = view.domAtPos(pos).node.marks.find(m => m.type === schema.marks.comment)?.attrs;
            if (attrs && attrs.commentId && event.target.matches('span[data-comment-id]')) {
              this.options.onCommentClick(attrs.commentId);
            }
            return false;
          },
        },
      }),
    ];
  },
});

export default CommentMark;
