import { useCurrentUser } from '~/stores-universal/context';

import type { IQuestionHasId } from '../../interfaces/question';

type QuestionProps = {
  question: IQuestionHasId,
  inputNamePrefix: string,
}

const Question = ({ question, inputNamePrefix }: QuestionProps): JSX.Element => {
  const { data: currentUser } = useCurrentUser();
  const lang = currentUser?.lang;

  const questionText = lang === 'en_US' ? question.text.en_US : question.text.ja_JP;

  return (
    <div className="row mt-4">
      <div className="col-6 d-flex align-items-center">
        <span>
          {questionText}
        </span>
      </div>
      <div className="col-6 d-flex align-items-center ps-0">
        <div className="btn-group flex-fill grw-questionnaire-btn-group">
          <label className="form-label btn btn-outline-primary active me-4 rounded">
            <input type="radio" name={`${inputNamePrefix + question._id}`} id={`${question._id}-noAnswer`} value="0" defaultChecked /> -
          </label>
          <label className="form-label btn btn-outline-primary rounded-start">
            <input type="radio" name={`${inputNamePrefix + question._id}`} id={`${question._id}-option1`} value="1" /> 1
          </label>
          <label className="form-label btn btn-outline-primary">
            <input type="radio" name={`${inputNamePrefix + question._id}`} id={`${question._id}-option2`} value="2" /> 2
          </label>
          <label className="form-label btn btn-outline-primary">
            <input type="radio" name={`${inputNamePrefix + question._id}`} id={`${question._id}-option3`} value="3" /> 3
          </label>
          <label className="form-label btn btn-outline-primary">
            <input type="radio" name={`${inputNamePrefix + question._id}`} id={`${question._id}-option4`} value="4" /> 4
          </label>
          <label className="form-label btn btn-outline-primary">
            <input type="radio" name={`${inputNamePrefix + question._id}`} id={`${question._id}-option5`} value="5" /> 5
          </label>
        </div>
      </div>
    </div>
  );
};

export default Question;
