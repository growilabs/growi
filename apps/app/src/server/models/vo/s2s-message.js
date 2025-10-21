/**
 * Server-to-server message VO
 */
class S2sMessage {
  constructor(eventName, body = {}) {
    this.eventName = eventName;
    for (const [key, value] of Object.entries(body)) {
      this[key] = value;
    }
  }

  setPublisherUid(uid) {
    this.publisherUid = uid;
  }

  static parse(messageString) {
    const body = JSON.parse(messageString);

    if (body.eventName == null) {
      throw new Error("message body must contain 'eventName'");
    }

    return new S2sMessage(body.eventName, body);
  }
}

module.exports = S2sMessage;
