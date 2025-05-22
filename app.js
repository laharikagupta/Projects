const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const SALT_ROUNDS_FOR_PASSWORD_HASHING = 10;
const AUTHORIZATION_SECRET_FOR_JWT = "AUTHORIZATION_KEY";

const twitterCloneDatabaseFilePath = path.join(__dirname, "twitterClone.db");
const sqliteDriver = sqlite3.Database;

let twitterCloneDBConnectionObj = null;

const initializeDBAndServer = async () => {
  try {
    twitterCloneDBConnectionObj = await open({
      filename: twitterCloneDatabaseFilePath,
      driver: sqliteDriver,
    });

    app.listen(3000, () => {
      console.log("Server running and listening on port 3000 !");
      console.log("Base URL - http://localhost:3000");
    });
  } catch (exception) {
    console.log(`Error initializing database or server: ${exception.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

/*
    Function Name : isTweetPostedByLoggedInUser
    Function Type : Middleware
    ----------------------------------------------------
    Middleware function to check if the input 
    tweet id was posted by the logged in user. Invoked
    by another middleware: checkUserRequestAuthorization.
    Gives control to the intended request handler
    upon the call to "next".  
*/
const isTweetPostedByLoggedInUser = async (req, res, next) => {
  const { username } = req;
  const { tweetId } = req.params;

  const loggedInUserDetails = await getSpecificUserDetailsFromDB(username);
  const userId = loggedInUserDetails.user_id;

  const queryToGetSpecificTweetDataPostedByLoggedInUser = `
    SELECT *
    FROM tweet
    WHERE
        tweet_id = ${tweetId}
        AND
        user_id = ${userId};
    `;

  const specificTweetDataPostedByLoggedInUser = await twitterCloneDBConnectionObj.get(
    queryToGetSpecificTweetDataPostedByLoggedInUser
  );
  if (specificTweetDataPostedByLoggedInUser === undefined) {
    res.status(401);
    res.send("Invalid Request");
  } else {
    next(); // Gives control to the next middleware
    // or handler of the intended request
    // handler.
  }
};

/*
    Function Name : isTweetPostedByAFollowingUser
    Function Type : Middleware
    ----------------------------------------------------
    Middleware function to check if the input 
    tweet id maps to a tweet posted by one of the
    users that the logged in user follows. Invoked
    by another middleware: checkUserRequestAuthorization.
    Adds new property to the req object: requestedTweetData
    if the requested tweet is indeed posted by a user
    followed by logged in user. Gives control to the intended
    request handler upon the call to "next".          
*/
const isTweetPostedByAFollowingUser = async (req, res, next) => {
  const { username } = req;
  const { tweetId } = req.params;

  const listOfFollowingUserIdObjects = await getListOfFollowingUserIdObjectsForSpecificUser(
    username
  );

  // Extract user ids from the objects as strings
  // and combine all into a single string to be used
  // in the following query
  const listOfFollowingUserIdsAsStrings = listOfFollowingUserIdObjects.map(
    (currentUserIdObj) => currentUserIdObj.following_user_id.toString()
  );
  const stringOfAllFollowingUserIds = listOfFollowingUserIdsAsStrings.join(
    ", "
  );

  const queryToGetSpecificTweetData = `
    SELECT
        *
    FROM
        tweet
    WHERE
        tweet_id = ${tweetId}
        AND
        user_id IN (${stringOfAllFollowingUserIds});
    `;

  const specificTweetData = await twitterCloneDBConnectionObj.get(
    queryToGetSpecificTweetData
  );
  if (specificTweetData === undefined) {
    res.status(401);
    res.send("Invalid Request");
  } else {
    // Tweet posted by a following user
    req.requestedTweetData = specificTweetData;
    next();
  }
};

/*
    Function Name : checkUserRequestAuthorization
    Function Type : Middleware
    ----------------------------------------------
    Middleware function with logic to check user
    authorization based on the available JSON Web 
    Token value in the request header
*/
const checkUserRequestAuthorization = async (req, res, next) => {
  const authorizationHeaderValue = req.headers.authorization;
  if (authorizationHeaderValue === undefined) {
    // No authorization header has been
    // passed in the http request
    res.status(401);
    res.send("Invalid JWT Token");
  } else {
    const jsonWebTokenFromRequestHeader = authorizationHeaderValue.split(
      " "
    )[1];
    await jwt.verify(
      jsonWebTokenFromRequestHeader,
      AUTHORIZATION_SECRET_FOR_JWT,
      (verificationError, userIdentifiablePayload) => {
        if (verificationError) {
          // Incorrect JSON Web Token
          res.status(401);
          res.send("Invalid JWT Token");
        } else {
          // Authorization Check Pass !
          const { username } = userIdentifiablePayload;
          req.username = username;
          next(); // Gives execution control to the next middleware
          // or handler method of the HTTP request method
          // that invoked this middleware.
        }
      }
    );
  }
};

/*
    Function Name          : getSpecificUserDetailsFromDB
    Input Parameter        :
        - specificUsername : Username of specific user
    Return Value           : Object with details of specific
                             user
    -------------------------------------------------------
    Description: Arrow function to fetch user details from
                 user table in the twitter clone database,
                 matching the input username. Need to make
                 caller method async as well to use await
                 keyword with this function's call, as this
                 function is also async.                        
*/
const getSpecificUserDetailsFromDB = async (specificUsername) => {
  const queryToGetSpecificUserDetails = `
    SELECT
        *
    FROM
        user
    WHERE
        username = '${specificUsername}';
    `;

  const specificUserDetails = await twitterCloneDBConnectionObj.get(
    queryToGetSpecificUserDetails
  );
  return specificUserDetails;
};

/*
    Function Name          : getListOfFollowingUserIdObjectsForSpecificUser
    Input Parameter        :
        - specificUsername : Username of specific user
    Return Value           : List of following user id objects
                             being followed by specific
                             user with the input username
    ------------------------------------------------------------------------
    Description: Arrow function to fetch list of following
                 user ids from follower table in the twitter
                 clone database,specific to the input username.
                 Need to make caller method async as well to use
                 await keyword with this function's call, as this
                 function is also async.                        
*/
const getListOfFollowingUserIdObjectsForSpecificUser = async (
  specificUsername
) => {
  const specificUserDetails = await getSpecificUserDetailsFromDB(
    specificUsername
  );
  const { user_id } = specificUserDetails;

  const queryToFetchFollowingUserIDs = `
                SELECT
                    following_user_id
                FROM
                    follower
                WHERE
                    follower_user_id = ${user_id};
                `;

  const listOfFollowingUserIdObjects = await twitterCloneDBConnectionObj.all(
    queryToFetchFollowingUserIDs
  );

  return listOfFollowingUserIdObjects;
};

/*
    Function Name   : isExistingUser
    Input Parameter : inputUsername
    Return Value    : Boolean true for existing user
                      and false otherwise
    -------------------------------------------------
    Description: Function to check if a user exists
                 with the given username.
*/
const isExistingUser = async (inputUsername) => {
  let existingUserCheckResult = {
    userExists: true,
    existingUserData: {},
  };

  const existingUserDataFromDB = await getSpecificUserDetailsFromDB(
    inputUsername
  );

  if (existingUserDataFromDB !== undefined) {
    existingUserCheckResult.existingUserData = existingUserDataFromDB;
  } else {
    existingUserCheckResult.userExists = false;
  }

  return existingUserCheckResult;
};

/*
    Function Name   : validateUsername
    Input Parameter : inputUsername
    Return Value    : Validation Result Object
        - isNewUser : Boolean true for new user
                      and false otherwise
        - failedMsg : Failed validation message
    --------------------------------------------
    Description: Function to validate input
                 username and accordingly
                 return the result in an object.
*/
const validateUsername = async (inputUsername) => {
  let validationResult = {
    isNewUser: true,
    failedMsg: "",
  };

  const userCheckResult = await isExistingUser(inputUsername);
  if (userCheckResult.userExists) {
    validationResult.isNewUser = false;
    validationResult.failedMsg = "User already exists";
  }

  return validationResult;
};

/*
    Function Name         : validatePassword
    Input Parameter       : inputPassword
    Return Value          : Validation Result Object
        - isValidPassword : Boolean true for valid
                            password and false otherwise
        - failedMsg       : Failed validation message
    -----------------------------------------------------
    Description: Function to validate input
                 password and accordingly
                 return the result in an object.
*/
const validatePassword = (inputPassword) => {
  let validationResult = {
    isValidPassword: true,
    failedMsg: "",
  };

  if (inputPassword.length < 6) {
    validationResult.isValidPassword = false;
    validationResult.failedMsg = "Password is too short";
  }

  return validationResult;
};

/*
    Function Name         : verifyLoginPassword
    Input Parameters      :
        - inputUsername   : Input username to fetch
                            existing user data
        - inputPassword   : Input password to compare
                            with hashed password stored
                            in the database for existing
                            user
    Return Value          : Validation Result Object
        - isValidPassword : Boolean true for valid
                            password and false otherwise
        - failedMsg       : Failed validation message
    -----------------------------------------------------
    Description: Function to validate input
                 password and accordingly
                 return the result in an object.
*/
const verifyLoginCredentials = async (inputUsername, inputPassword) => {
  const loginCredentialsCheckResult = {
    isUsernameValid: true,
    isPasswordValid: true,
  };

  const userCheckResult = await isExistingUser(inputUsername);
  if (!userCheckResult.userExists) {
    loginCredentialsCheckResult.isUsernameValid = false;
    loginCredentialsCheckResult.isPasswordValid = false;
  } else {
    // valid username
    const userDataFromDB = userCheckResult.existingUserData;
    const hashedPassword = userDataFromDB.password;

    let isMatchingPassword = await bcrypt.compare(
      inputPassword,
      hashedPassword
    );
    if (!isMatchingPassword) {
      loginCredentialsCheckResult.isPasswordValid = false;
    }
  }

  return loginCredentialsCheckResult;
};

/*
    Function Name           : getLikesDataOfSpecificTweet
    Input Parameters        :
        - specificTweetId   : Id of the requested tweet
                              data
    Return Value            : List of "like" data objects
    -----------------------------------------------------
    Description: Function to fetch list of tweet-like 
                 data objects from the "like" table.
*/
const getLikesDataOfSpecificTweet = async (requestedTweetId) => {
  const queryToFetchLikeDataOfSpecificTweet = `
    SELECT
        *
    FROM
        like
    WHERE
        tweet_id = ${requestedTweetId};
    `;

  const likesDataFOrSpecificTweet = await twitterCloneDBConnectionObj.all(
    queryToFetchLikeDataOfSpecificTweet
  );
  return likesDataFOrSpecificTweet;
};

/*
    Function Name           : getRepliesDataOfSpecificTweet
    Input Parameters        :
        - specificTweetId   : Id of the requested tweet
                              data
    Return Value            : List of "reply" data objects
    -----------------------------------------------------
    Description: Function to fetch list of tweet-reply 
                 data objects from the "reply" table.
*/
const getRepliesDataOfSpecificTweet = async (requestedTweetId) => {
  const queryToFetchReplyDataOfSpecificTweet = `
    SELECT
        *
    FROM
        reply
    WHERE
        tweet_id = ${requestedTweetId};
    `;

  const repliesDataFOrSpecificTweet = await twitterCloneDBConnectionObj.all(
    queryToFetchReplyDataOfSpecificTweet
  );
  return repliesDataFOrSpecificTweet;
};

/*
    End-Point 1: POST /register
    ------------
    To register/add new user
    to the user table with
    checks in place to validate
    input username and password
*/
app.post("/register", async (req, res) => {
  const { username, password, name, gender } = req.body;

  const usernameValidationResult = await validateUsername(username);

  if (!usernameValidationResult.isNewUser) {
    res.status(400);
    res.send(usernameValidationResult.failedMsg);
  } else {
    const passwordValidationResult = validatePassword(password);

    if (!passwordValidationResult.isValidPassword) {
      res.status(400);
      res.send(passwordValidationResult.failedMsg);
    } else {
      const hashedPassword = await bcrypt.hash(
        password,
        SALT_ROUNDS_FOR_PASSWORD_HASHING
      );

      const queryToAddNewUser = `
        INSERT INTO
            user (username, password, name, gender)
        VALUES
            ('${username}', '${hashedPassword}', '${name}', '${gender}');
        
        `;

      const addNewUserDBResponse = await twitterCloneDBConnectionObj.run(
        queryToAddNewUser
      );

      res.send("User created successfully");
    } // End of else-part of inner if-statement with condition: (!passwordValidationResult.isValidPassword)
  } // End of else-part of outer if-statement with condition: (!usernameValidationResult.isNewUser)
});

/*
    End-Point 2: POST /login
    ------------
    To login a user based on 
    input credentials, after
    verification of the same
*/
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const loginCredentialsCheckResult = await verifyLoginCredentials(
    username,
    password
  );
  if (!loginCredentialsCheckResult.isUsernameValid) {
    res.status(400);
    res.send("Invalid user");
  } else if (!loginCredentialsCheckResult.isPasswordValid) {
    res.status(400);
    res.send("Invalid password");
  } else {
    // login success !
    const userIdentifiablePayload = { username };
    const jwtToken = jwt.sign(
      userIdentifiablePayload,
      AUTHORIZATION_SECRET_FOR_JWT
    );
    res.send({ jwtToken });
  }
});

/*
    End-Point 3  : GET /user/tweets/feed
    Header Name  : Authorization
    Header Value : Bearer JSON_WEB_TOKEN
    --------------
    To fetch latest 4 tweets posted by
    users followed by the logged in user

*/
app.get(
  "/user/tweets/feed",
  checkUserRequestAuthorization,
  async (req, res) => {
    const { username } = req; // username property
    // added by checkUserRequestAuthorization
    // middleware to req object.

    const listOfFollowingUserIdObjects = await getListOfFollowingUserIdObjectsForSpecificUser(
      username
    );

    const listOfFollowingUserIds = listOfFollowingUserIdObjects.map(
      (currentFollowingUserIdObject) =>
        currentFollowingUserIdObject.following_user_id.toString()
    );

    const followingUserIdsString = listOfFollowingUserIds.join(", ");

    const queryToFetchLatest4TweetsFromFollowingUserIds = `
          SELECT
            user.username AS username,
            tweet.tweet AS tweet,
            tweet.date_time AS date_time
          FROM 
            tweet
          INNER JOIN 
            user
          ON
            tweet.user_id = user.user_id
          WHERE
            tweet.user_id IN (${followingUserIdsString})
          ORDER BY
            tweet.date_time DESC
          LIMIT 4;
          `;

    const latest4TweetsFromFollowingUserIds = await twitterCloneDBConnectionObj.all(
      queryToFetchLatest4TweetsFromFollowingUserIds
    );
    const processedLatest4TweetsFromFollowingUserIds = latest4TweetsFromFollowingUserIds.map(
      (currentTweet) => ({
        username: currentTweet.username,
        tweet: currentTweet.tweet,
        dateTime: currentTweet.date_time,
      })
    );
    res.send(processedLatest4TweetsFromFollowingUserIds);
  }
);

/*
    End-Point 4  : GET /user/following
    Header Name  : Authorization
    Header Value : Bearer JSON_WEB_TOKEN
    --------------
    To fetch names of uses that the logged
    in user is following, with appropriate
    checks in place to check for 
    authorization through JSON Web Token
*/
app.get("/user/following", checkUserRequestAuthorization, async (req, res) => {
  const { username } = req;

  const listOfFollowingUserIdObjects = await getListOfFollowingUserIdObjectsForSpecificUser(
    username
  );

  // Extract just the following_user_id's as
  // strings into an array.
  const listOfFollowingUserIds = listOfFollowingUserIdObjects.map(
    (currentFollowingUserIdObject) =>
      currentFollowingUserIdObject.following_user_id.toString()
  );

  // Combine all following_user_id's into a single
  // string, in order to be embedded into the
  // following query string literal WHERE clause,
  // to extract corresponding usernames.
  const stringOfFollowingUserIds = listOfFollowingUserIds.join(",");

  const queryToFetchCorrespondingNamesOfAllFollowingUserIds = `
  SELECT
    name
  FROM
    user
  WHERE
    user_id IN (${stringOfFollowingUserIds});
  `;

  const listOfNameObjectsForFollowingUserIds = await twitterCloneDBConnectionObj.all(
    queryToFetchCorrespondingNamesOfAllFollowingUserIds
  );

  res.send(listOfNameObjectsForFollowingUserIds);
});

/*
    End-Point 5  : GET /user/followers
    Header Name  : Authorization
    Header Value : Bearer JSON_WEB_TOKEN
    ------------------------------------
    To fetch list of usernames of users
    that follow the logged in user 
*/
app.get("/user/followers", checkUserRequestAuthorization, async (req, res) => {
  const { username } = req;

  const loggedInUserDetails = await getSpecificUserDetailsFromDB(username);
  const { user_id } = loggedInUserDetails;

  const queryToFetchListOfFollowerUserIdObjectsForLoggedInUser = `
    SELECT
        follower_user_id
    FROM
        follower
    WHERE
        following_user_id = ${user_id};
    `;

  const listOfFollowerUserIdObjects = await twitterCloneDBConnectionObj.all(
    queryToFetchListOfFollowerUserIdObjectsForLoggedInUser
  );

  // Get list of follower_user_id's as strings
  // to be joined into a single string and used
  // in the following query to fetch list of names
  // of follower_user_id's
  const listOfFollowerUserIdsAsStrings = listOfFollowerUserIdObjects.map(
    (currentUserId) => currentUserId.follower_user_id.toString()
  );
  const stringOfFollowerUserIds = listOfFollowerUserIdsAsStrings.join(",");

  const queryToFetchListOfNameObjectsOfAllFollowerUserIds = `
    SELECT
        name
    FROM
        user
    WHERE
        user_id IN (${stringOfFollowerUserIds});
    `;

  const listOfNameObjectsOfAllFollowerUserIds = await twitterCloneDBConnectionObj.all(
    queryToFetchListOfNameObjectsOfAllFollowerUserIds
  );
  res.send(listOfNameObjectsOfAllFollowerUserIds);
});

/*
    End-Point 6  : GET /tweets/:tweetId
    Header Name  : Authorization
    Header Value : Bearer JSON_WEB_TOKEN 
    --------------
    To fetch tweet data like tweet text,
    likes, replies, with id: tweetId,
    only if it was posted by users being
    followed by logged in user.
*/
app.get(
  "/tweets/:tweetId",
  checkUserRequestAuthorization,
  isTweetPostedByAFollowingUser,
  async (req, res) => {
    const { requestedTweetData } = req;
    const { tweet_id } = requestedTweetData;

    const likesDataOfRequestedTweet = await getLikesDataOfSpecificTweet(
      tweet_id
    );
    const repliesDataOfRequestedTweet = await getRepliesDataOfSpecificTweet(
      tweet_id
    );

    const numberOfLikes = likesDataOfRequestedTweet.length;
    const numberOfReplies = repliesDataOfRequestedTweet.length;

    const requestedTweetAndRelatedData = {
      tweet: requestedTweetData.tweet,
      likes: numberOfLikes,
      replies: numberOfReplies,
      dateTime: requestedTweetData.date_time,
    };

    res.send(requestedTweetAndRelatedData);
  }
);

/*
  End-Point 7  : GET /tweets/:tweetId/likes
  Header Name  : Authorization
  Header Value : Bearer JSON_WEB_TOKEN
  --------------
  To fetch the list of usernames of users
  that like the tweet with id: tweetId,
  after the verification on the requested
  tweet to have been posted by a user, that
  the logged in user follows.  
*/
app.get(
  "/tweets/:tweetId/likes",
  checkUserRequestAuthorization,
  isTweetPostedByAFollowingUser,
  async (req, res) => {
    const { requestedTweetData } = req; // requestedTweetData added by middleware: isTweetPostedByAFollowingUser
    const tweetId = requestedTweetData.tweet_id;

    const likesDataOfRequestedTweet = await getLikesDataOfSpecificTweet(
      tweetId
    );

    // Extract user_id's as strings and
    // combine all into a string to be
    // used in the following query.
    const listOfUserIdsAsStringsFromTweetLikesData = likesDataOfRequestedTweet.map(
      (currentLikeData) => currentLikeData.user_id.toString()
    );
    const stringOfAllUserIds = listOfUserIdsAsStringsFromTweetLikesData.join(
      ", "
    );

    const queryToFetchUsernamesOfUsersThatLikedRequestedTweet = `
    SELECT
        user.username AS username
    FROM
        user
    WHERE
        user_id IN (${stringOfAllUserIds});
    `;

    const listOfUsernameObjects = await twitterCloneDBConnectionObj.all(
      queryToFetchUsernamesOfUsersThatLikedRequestedTweet
    );
    const listOfUsernames = listOfUsernameObjects.map(
      (currentUsernameObj) => currentUsernameObj.username
    );

    const requestedLikesData = {
      likes: listOfUsernames,
    };

    res.send(requestedLikesData);
  }
);

/*
  End-Point 8  : GET /tweets/:tweetId/replies
  Header Name  : Authorization
  Header Value : Bearer JSON_WEB_TOKEN
  --------------
  To fetch the list of replies for a specific
  tweet with id: tweetId, after ensuring the
  requested tweet is posted by a user that
  the logged in user follows. 
*/
app.get(
  "/tweets/:tweetId/replies",
  checkUserRequestAuthorization,
  isTweetPostedByAFollowingUser,
  async (req, res) => {
    const { requestedTweetData } = req;
    const tweetId = requestedTweetData.tweet_id;

    const repliesDataOfRequestedTweet = await getRepliesDataOfSpecificTweet(
      tweetId
    );

    // Extract user ids from the replies data
    // as strings and combine them all into a
    // single string to be used in the following
    // query.
    const listOfUserIdStringsThatRepliedToRequestedTweet = repliesDataOfRequestedTweet.map(
      (currentReplyData) => currentReplyData.user_id.toString()
    );
    const stringOfAllUserIds = listOfUserIdStringsThatRepliedToRequestedTweet.join(
      ", "
    );

    const queryToFetchNameOfUserAndReplyTextForAllReplies = `
    SELECT
        user.name AS name,
        reply.reply AS reply
    FROM
        reply
        INNER JOIN user
        ON reply.user_id = user.user_id
    WHERE
        reply.user_id IN (${stringOfAllUserIds})
        AND
        reply.tweet_id = ${tweetId};
    `;

    const listOfNameOfUserAndReplyTextDataObjects = await twitterCloneDBConnectionObj.all(
      queryToFetchNameOfUserAndReplyTextForAllReplies
    );

    const requestedRepliesData = {
      replies: listOfNameOfUserAndReplyTextDataObjects,
    };

    res.send(requestedRepliesData);
  }
);

/*
  End-Point 9  : GET /user/tweets
  Header Name  : Authorization
  Header Value : Bearer JSON_WEB_TOKEN
  --------------
  To fetch data of tweets
  posted by the logged in
  user, such as, tweet text,
  number of likes, number of
  replies and the date_time
  it was posted.
*/
app.get("/user/tweets", checkUserRequestAuthorization, async (req, res) => {
  const { username } = req;
  const loggedInUserDetails = await getSpecificUserDetailsFromDB(username);
  const userId = loggedInUserDetails.user_id;

  const queryToGetAllTweetRelatedForLoggedInUser = `
    SELECT
        tweet,
        (SELECT COUNT(*)
         FROM like
         WHERE like.tweet_id = tweet.tweet_id) AS likes,
        (SELECT COUNT(*)
         FROM reply
         WHERE reply.tweet_id = tweet.tweet_id) AS replies,
        date_time
    FROM
        tweet
    WHERE
        user_id = ${userId};
    `;

  const listOfAllTweetsPostedByLoggedInUser = await twitterCloneDBConnectionObj.all(
    queryToGetAllTweetRelatedForLoggedInUser
  );
  const processedListOfAllTweetsPostedByLoggedInUser = listOfAllTweetsPostedByLoggedInUser.map(
    (currentTweetData) => ({
      tweet: currentTweetData.tweet,
      likes: currentTweetData.likes,
      replies: currentTweetData.replies,
      dateTime: currentTweetData.date_time,
    })
  );

  res.send(processedListOfAllTweetsPostedByLoggedInUser);
});

/*
    End-Point 10 : POST /user/tweets
    Header Name  : Authorization
    Header Value : Bearer JSON_WEB_TOKEN
    -------------------------------------
    To add new tweet to the tweet table
*/
app.post("/user/tweets", checkUserRequestAuthorization, async (req, res) => {
  const { username } = req;

  const loggedInUserDetails = await getSpecificUserDetailsFromDB(username);
  const userId = loggedInUserDetails.user_id;

  const { tweet } = req.body;

  const currentDateTime = new Date();
  const currentFullYear = currentDateTime.getFullYear();
  const currentMonth = currentDateTime.getMonth();
  const currentDay = currentDateTime.getDate();
  const currentHour = currentDateTime.getHours();
  const currentMinuteCount = currentDateTime.getMinutes();
  const currentSecondCount = currentDateTime.getSeconds();

  const formattedCurrentDateTime = `${currentFullYear}-${currentMonth}-${currentDay} ${currentHour}:${currentMinuteCount}:${currentSecondCount}`;

  const queryToAddNewTweetData = `
    INSERT INTO
        tweet (tweet, user_id, date_time)
    VALUES
        ('${tweet}', ${userId}, '${formattedCurrentDateTime}');
    `;

  const addNewTweetDBResponse = await twitterCloneDBConnectionObj.run(
    queryToAddNewTweetData
  );

  res.send("Created a Tweet");
});

/*
    End-Point 11 : DELETE /tweets/:tweetId
    Header Name  : Authorization
    Header Value : Bearer JSON_WEB_TOKEN
    --------------
    To delete tweet with id: tweetId, after
    ensuring that the tweet was posted by
    the logged in user and not by another
    user being followed by logged in user. 
*/
app.delete(
  "/tweets/:tweetId",
  checkUserRequestAuthorization,
  isTweetPostedByLoggedInUser,
  async (req, res) => {
    const { tweetId } = req.params;
    const { username } = req;

    const loggedInUserDetails = await getSpecificUserDetailsFromDB(username);
    const userId = loggedInUserDetails.user_id;

    const queryToDeleteSpecificTweetPostedByLoggedInUser = `
    DELETE FROM
        tweet
    WHERE
        tweet_id = ${tweetId}
        AND
        user_id = ${userId};
    `;

    await twitterCloneDBConnectionObj.run(
      queryToDeleteSpecificTweetPostedByLoggedInUser
    );
    res.send("Tweet Removed");
  }
);

module.exports = app;
