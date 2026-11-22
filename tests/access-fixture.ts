/** Unit-test token only. GoTrue verification is mocked by each isolated fixture. */
export const testAccessToken=(uid:string,sid='44444444-4444-4444-8444-444444444444')=>'test.'+Buffer.from(JSON.stringify({sub:uid,session_id:sid})).toString('base64url')+'.test-signature';
