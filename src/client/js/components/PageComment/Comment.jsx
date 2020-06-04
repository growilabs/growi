import React from 'react';
import PropTypes from 'prop-types';

import { format } from 'date-fns';

import { UncontrolledTooltip } from 'reactstrap';

import AppContainer from '../../services/AppContainer';
import PageContainer from '../../services/PageContainer';

import { createSubscribedElement } from '../UnstatedUtils';

import FormattedDistanceDate from '../FormattedDistanceDate';
import RevisionBody from '../Page/RevisionBody';
import UserPicture from '../User/UserPicture';
import Username from '../User/Username';
import CommentEditor from './CommentEditor';
import CommentControl from './CommentControl';

/**
 *
 * @author Yuki Takei <yuki@weseek.co.jp>
 *
 * @export
 * @class Comment
 * @extends {React.Component}
 */
class Comment extends React.PureComponent {

  constructor(props) {
    super(props);

    this.state = {
      html: '',
      isReEdit: false,
    };

    this.isCurrentUserIsAuthor = this.isCurrentUserEqualsToAuthor.bind(this);
    this.isCurrentRevision = this.isCurrentRevision.bind(this);
    this.getRootClassName = this.getRootClassName.bind(this);
    this.getRevisionLabelClassName = this.getRevisionLabelClassName.bind(this);
    this.deleteBtnClickedHandler = this.deleteBtnClickedHandler.bind(this);
    this.renderText = this.renderText.bind(this);
    this.renderHtml = this.renderHtml.bind(this);
  }


  initCurrentRenderingContext() {
    this.currentRenderingContext = {
      markdown: this.props.comment.comment,
    };
  }

  componentDidMount() {
    this.initCurrentRenderingContext();
    this.renderHtml();
  }

  componentDidUpdate(prevProps) {
    const { comment: prevComment } = prevProps;
    const { comment } = this.props;

    // render only when props.markdown is updated
    if (comment !== prevComment) {
      this.initCurrentRenderingContext();
      this.renderHtml();
      return;
    }

    const { interceptorManager } = this.props.appContainer;

    interceptorManager.process('postRenderCommentHtml', this.currentRenderingContext);
  }

  checkPermissionToControlComment() {
    return this.props.appContainer.isAdmin || this.isCurrentUserEqualsToAuthor();
  }

  isCurrentUserEqualsToAuthor() {
    return this.props.comment.creator.username === this.props.appContainer.currentUsername;
  }

  isCurrentRevision() {
    return this.props.comment.revision === this.props.pageContainer.state.revisionId;
  }

  getRootClassName(comment) {
    let className = 'page-comment flex-column';

    const { revisionId, revisionCreatedAt } = this.props.pageContainer.state;
    if (comment.revision === revisionId) {
      className += ' page-comment-current';
    }
    else if (Date.parse(comment.createdAt) / 1000 > revisionCreatedAt) {
      className += ' page-comment-newer';
    }
    else {
      className += ' page-comment-older';
    }

    if (this.isCurrentUserEqualsToAuthor()) {
      className += ' page-comment-me';
    }

    return className;
  }

  getRevisionLabelClassName() {
    return `page-comment-revision badge ${
      this.isCurrentRevision() ? 'badge-primary' : 'badge-secondary'}`;
  }

  deleteBtnClickedHandler() {
    this.props.deleteBtnClicked(this.props.comment);
  }

  renderText(comment) {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{comment}</span>;
  }

  renderRevisionBody() {
    const config = this.props.appContainer.getConfig();
    const isMathJaxEnabled = !!config.env.MATHJAX;
    return (
      <RevisionBody
        html={this.state.html}
        isMathJaxEnabled={isMathJaxEnabled}
        renderMathJaxOnInit
        additionalClassName="comment"
      />
    );
  }

  async renderHtml() {

    const { growiRenderer, appContainer } = this.props;
    const { interceptorManager } = appContainer;
    const context = this.currentRenderingContext;

    await interceptorManager.process('preRenderComment', context);
    await interceptorManager.process('prePreProcess', context);
    context.markdown = await growiRenderer.preProcess(context.markdown);
    await interceptorManager.process('postPreProcess', context);
    context.parsedHTML = await growiRenderer.process(context.markdown);
    await interceptorManager.process('prePostProcess', context);
    context.parsedHTML = await growiRenderer.postProcess(context.parsedHTML);
    await interceptorManager.process('postPostProcess', context);
    await interceptorManager.process('preRenderCommentHtml', context);
    this.setState({ html: context.parsedHTML });
    await interceptorManager.process('postRenderCommentHtml', context);
  }

  render() {
    const comment = this.props.comment;
    const commentId = comment._id;
    const creator = comment.creator;
    const isMarkdown = comment.isMarkdown;
    const createdAt = new Date(comment.createdAt);
    const updatedAt = new Date(comment.updatedAt);
    const isEdited = createdAt < updatedAt;

    const rootClassName = this.getRootClassName(comment);
    const commentBody = isMarkdown ? this.renderRevisionBody() : this.renderText(comment.comment);
    const revHref = `?revision=${comment.revision}`;
    const revFirst8Letters = comment.revision.substr(-8);
    const revisionLavelClassName = this.getRevisionLabelClassName();

    const editedDateId = `editedDate-${comment._id}`;
    const editedDateFormatted = isEdited
      ? format(updatedAt, 'yyyy/MM/dd HH:mm')
      : null;

    return (
      <React.Fragment>

        {this.state.isReEdit ? (
          <CommentEditor
            growiRenderer={this.props.growiRenderer}
            currentCommentId={commentId}
            commentBody={comment.comment}
            replyTo={undefined}
            commentCreator={creator.username}
            onCancelButtonClicked={() => this.setState({ isReEdit: false })}
            onCommentButtonClicked={() => this.setState({ isReEdit: false })}
          />
        ) : (
          <div id={commentId} className={rootClassName}>
            <div className="page-comment-writer">
              <UserPicture user={creator} />
            </div>
            <div className="page-comment-main">
              <div className="page-comment-creator">
                <Username user={creator} />
              </div>
              <div className="page-comment-body">{commentBody}</div>
              <div className="page-comment-meta">
                <a href={`#${commentId}`}>
                  <FormattedDistanceDate id={commentId} date={comment.createdAt} />
                </a>
                { isEdited && (
                  <>
                    <span id={editedDateId}>&nbsp;(edited)</span>
                    <UncontrolledTooltip placement="bottom" fade={false} target={editedDateId}>{editedDateFormatted}</UncontrolledTooltip>
                  </>
                ) }
                <span className="ml-2"><a className={revisionLavelClassName} href={revHref}>{revFirst8Letters}</a></span>
              </div>
              { this.checkPermissionToControlComment() && (
                <CommentControl
                  onClickDeleteBtn={this.deleteBtnClickedHandler}
                  onClickEditBtn={() => this.setState({ isReEdit: true })}
                />
              ) }
            </div>
          </div>
          )
        }

      </React.Fragment>
    );
  }

}

/**
 * Wrapper component for using unstated
 */
const CommentWrapper = (props) => {
  return createSubscribedElement(Comment, props, [AppContainer, PageContainer]);
};

Comment.propTypes = {
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,
  pageContainer: PropTypes.instanceOf(PageContainer).isRequired,

  comment: PropTypes.object.isRequired,
  growiRenderer: PropTypes.object.isRequired,
  deleteBtnClicked: PropTypes.func.isRequired,
};

export default CommentWrapper;
