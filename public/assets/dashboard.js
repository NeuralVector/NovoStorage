import { t as e } from './auth-LGnANc0L.js';
document.querySelector(`#sign-out`)?.addEventListener(`click`, () => {
	e();
});
const t = document.querySelector(`#file-input`),
	n = document.querySelector(`#upload-file`),
	r = document.querySelector(`#storage-status`),
	i = document.querySelector(`#storage-list`);
async function a() {
	try {
		let e = await fetch(`/api/files`);
		if (e.status === 401) {
			window.location.assign(`/login`);
			return;
		}
		if (!e.ok) throw Error(`Unable to load files (${e.status})`);
		let t = await e.json();
		if ((r && (r.textContent = t.length === 0 ? `No files yet.` : ``), !i)) return;
		i.replaceChildren();
		for (let e of t) {
			let t = document.createElement(`li`),
				n = document.createElement(`span`);
			if (
				((n.textContent = `${e.type === `directory` ? `📁` : `📄`} ${e.name}`),
				t.append(n),
				(t.title = e.path),
				e.type === `file`)
			) {
				let n = document.createElement(`button`);
				((n.type = `button`),
					(n.textContent = `Download`),
					n.addEventListener(`click`, () => {
						let t = new URLSearchParams({ path: e.path });
						window.location.assign(`/api/files/download?${t}`);
					}),
					t.append(` `, n));
			}
			i.append(t);
		}
	} catch (e) {
		r && (r.textContent = e instanceof Error ? e.message : `Unable to load files.`);
	}
}
(n?.addEventListener(`click`, () => {
	t?.click();
}),
	t?.addEventListener(`change`, async () => {
		let e = t,
			i = e.files?.[0];
		if (i) {
			(r && (r.textContent = `Uploading ${i.name}...`),
				n instanceof HTMLButtonElement && (n.disabled = !0));
			try {
				let t = new FormData();
				t.append(`file`, i, i.name);
				let n = await fetch(`/api/files`, { method: `POST`, body: t });
				if (n.status === 401) {
					window.location.assign(`/login`);
					return;
				}
				if (!n.ok) throw Error(`Unable to upload file (${n.status})`);
				((e.value = ``), await a());
			} catch (e) {
				r &&
					(r.textContent =
						e instanceof Error
							? e.message
							: `Unable to upload file.`);
			} finally {
				n instanceof HTMLButtonElement && (n.disabled = !1);
			}
		}
	}),
	a());
//# sourceMappingURL=dashboard.js.map
