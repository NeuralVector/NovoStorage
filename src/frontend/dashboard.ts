import { signOut } from './auth.ts';

document.querySelector('#sign-out')?.addEventListener('click', () => {
	signOut();
});
