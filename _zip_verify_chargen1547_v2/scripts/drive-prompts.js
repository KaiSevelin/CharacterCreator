const DRIVE_HINTS = {
    Adaptability: {
        prompt: "What flexibility or refusal to be trapped now defines you?",
        examples: [
            "I survive by changing faster than trouble can catch me.",
            "When the world shifts, I shift with it.",
            "I will not let pride make me rigid."
        ]
    },
    Ambition: {
        prompt: "What greater place do you mean to claim?",
        examples: [
            "I was not made to remain small.",
            "I mean to rise, whatever it costs.",
            "I will be remembered above my station."
        ]
    },
    Awe: {
        prompt: "What wonder or terror now commands your attention?",
        examples: [
            "Some things are too great to ignore.",
            "I have seen enough to know the world is larger than reason.",
            "I must draw nearer to what left me speechless."
        ]
    },
    Bitterness: {
        prompt: "What hurt still sours your choices?",
        examples: [
            "I do not forget who prospered while I suffered.",
            "Kindness comes too late for what was taken from me.",
            "The world owes me more than it has paid."
        ]
    },
    Boldness: {
        prompt: "What risk now feels worth taking?",
        examples: [
            "Fortune favors those who step forward first.",
            "I would rather act and pay for it than hesitate and lose.",
            "If fear rules the moment, I challenge it."
        ]
    },
    Calculation: {
        prompt: "What habit of measuring, planning, or exploiting now leads you?",
        examples: [
            "I count the cost before I move.",
            "Nothing important should be left to impulse.",
            "The patient hand wins more than the brave one."
        ]
    },
    Calling: {
        prompt: "What purpose feels larger than your comfort now?",
        examples: [
            "I have work in this world that I cannot ignore.",
            "I was led here for a reason.",
            "I must answer what keeps calling me forward."
        ]
    },
    Caution: {
        prompt: "What danger taught you to move carefully?",
        examples: [
            "A careful step today spares blood tomorrow.",
            "I trust warning signs more than promises.",
            "I move slowly where others rush."
        ]
    },
    "Cold Resolve": {
        prompt: "What hard purpose do you now pursue without sentiment?",
        examples: [
            "I will do what must be done without flinching.",
            "Mercy cannot always lead the hand.",
            "I keep my heart still when the work turns ugly."
        ]
    },
    Coldness: {
        prompt: "What made warmth feel costly or dangerous?",
        examples: [
            "Distance keeps me from being used.",
            "I do not offer more feeling than the world deserves.",
            "It is safer when my heart stays behind my judgment."
        ]
    },
    Compassion: {
        prompt: "Whose pain can you no longer ignore?",
        examples: [
            "I cannot turn away from suffering and still respect myself.",
            "If I can spare another what I endured, I must.",
            "The weak deserve more than pity; they deserve help."
        ]
    },
    Composure: {
        prompt: "What pressure taught you the value of calm?",
        examples: [
            "I do not let panic choose for me.",
            "A steady hand is worth more than loud courage.",
            "Others may break around me; I will not."
        ]
    },
    Confidence: {
        prompt: "What success taught you to trust yourself?",
        examples: [
            "I know my worth, even when others do not.",
            "I can carry more than doubt says I can.",
            "When the moment comes, I trust my own hand."
        ]
    },
    Conscience: {
        prompt: "What inner line do you refuse to cross now?",
        examples: [
            "There are deeds I will not excuse in myself.",
            "If I betray what is right, nothing I gain will matter.",
            "I must still be able to answer to myself."
        ]
    },
    Control: {
        prompt: "What must never again be left unchecked?",
        examples: [
            "I will not let chaos rule my life.",
            "I keep a firm hand on what matters.",
            "If I do not govern myself, something worse will."
        ]
    },
    Conviction: {
        prompt: "What belief now anchors your choices?",
        examples: [
            "I know what I stand for, even when it costs me.",
            "A wavering soul is too easy to bend.",
            "I would rather suffer for what I believe than live without it."
        ]
    },
    Courage: {
        prompt: "What fear have you decided to face?",
        examples: [
            "I go where fear says I should not.",
            "Bravery is the price of becoming who I must be.",
            "If danger comes, I meet it standing."
        ]
    },
    Curiosity: {
        prompt: "What question or mystery refuses to release you?",
        examples: [
            "I must know what lies behind the veil.",
            "Ignorance bothers me more than danger.",
            "If there is something to learn, I will press closer."
        ]
    },
    Daring: {
        prompt: "What leap now seems preferable to safety?",
        examples: [
            "A closed hand wins nothing.",
            "I would rather wager boldly than shrink quietly.",
            "Some paths only open if you seize them."
        ]
    },
    Defiance: {
        prompt: "What do you refuse to bow to now?",
        examples: [
            "No one will ever shame me into obedience again.",
            "I push back when power overreaches.",
            "I would rather suffer than submit."
        ]
    },
    Delight: {
        prompt: "What joy or appetite now gives your life direction?",
        examples: [
            "I mean to taste what life still offers.",
            "Beauty and pleasure are worth defending.",
            "I do not apologize for taking joy where I find it."
        ]
    },
    Destiny: {
        prompt: "What sense of fate now pulls you onward?",
        examples: [
            "I was spared for something that still lies ahead.",
            "Too many signs point me in one direction to ignore them.",
            "My path is not accidental."
        ]
    },
    Detachment: {
        prompt: "What distance from people or events now feels necessary?",
        examples: [
            "I keep enough distance to see clearly.",
            "Attachment clouds judgment when judgment matters most.",
            "I do not let every wound become my own."
        ]
    },
    Devotion: {
        prompt: "To whom or what are you now deeply bound?",
        examples: [
            "I belong to this cause more than I belong to comfort.",
            "What I serve deserves my whole heart.",
            "I measure myself by my faithfulness."
        ]
    },
    Discipline: {
        prompt: "What rule, habit, or standard now governs you?",
        examples: [
            "I will master myself before I try to master anything else.",
            "I do not break under pressure.",
            "Order is the shield that keeps ruin out."
        ]
    },
    Discretion: {
        prompt: "What taught you the value of silence and restraint?",
        examples: [
            "Not every truth should be spoken aloud.",
            "I keep what matters out of careless hands.",
            "A guarded tongue survives longer than a loose one."
        ]
    },
    Distrust: {
        prompt: "What lesson made trust difficult?",
        examples: [
            "Promises are masks until proven otherwise.",
            "I rely on myself before I rely on anyone.",
            "Trust is earned slowly and lost at once."
        ]
    },
    Doubt: {
        prompt: "What uncertainty now shadows your decisions?",
        examples: [
            "I no longer accept easy certainty.",
            "What I believed once failed me.",
            "I question what others take for granted."
        ]
    },
    Dread: {
        prompt: "What looming fear now shapes your choices?",
        examples: [
            "I feel disaster before it shows its face.",
            "I prepare because I know how quickly things worsen.",
            "Some ending is coming, and I mean to meet it ready."
        ]
    },
    Duty: {
        prompt: "What obligation now defines your path?",
        examples: [
            "What is mine to carry, I will carry.",
            "Duty matters more than ease.",
            "I do not step away from what has been placed in my hands."
        ]
    },
    Endurance: {
        prompt: "What hardship taught you how to continue?",
        examples: [
            "I can outlast more than most people think.",
            "Pain passes; giving up leaves a mark.",
            "I keep going when easier souls stop."
        ]
    },
    Envy: {
        prompt: "What do you now hunger for because another possessed it first?",
        examples: [
            "I am tired of watching others hold what I deserve.",
            "Their ease sharpened my hunger.",
            "I want what the favored take for granted."
        ]
    },
    Faith: {
        prompt: "What trust, creed, or holy certainty now sustains you?",
        examples: [
            "I hold to what is sacred when the world grows thin.",
            "Meaning is not gone simply because suffering exists.",
            "I trust that I am answerable to something higher."
        ]
    },
    Fear: {
        prompt: "What fear now rules or warns you?",
        examples: [
            "I remember too well what happens when caution fails.",
            "Fear keeps me alive if I listen to it wisely.",
            "I do not mistake terror for weakness."
        ]
    },
    Ferocity: {
        prompt: "What fight has awakened something savage in you?",
        examples: [
            "When pushed, I answer with force.",
            "I do not intend to be prey again.",
            "There are moments when mercy must step aside."
        ]
    },
    Freedom: {
        prompt: "What makes constraint unbearable to you now?",
        examples: [
            "No one owns my path but me.",
            "I will pay dearly rather than live in chains.",
            "Space to choose matters more than comfort."
        ]
    },
    Glory: {
        prompt: "What recognition or greatness now calls to you?",
        examples: [
            "I mean to do something worth speaking of.",
            "A life unnoticed feels half-lived.",
            "I want my deeds to ring beyond my own years."
        ]
    },
    Gratitude: {
        prompt: "What gift or mercy now compels you to answer in kind?",
        examples: [
            "I do not forget the hands that lifted me.",
            "Because I was shown mercy, I must not waste it.",
            "What I received should be honored by what I become."
        ]
    },
    Gravity: {
        prompt: "What solemn truth now weighs on you?",
        examples: [
            "I carry myself like someone who has seen too much to be careless.",
            "Some things are too serious for lightness.",
            "I mean to treat consequence with the respect it deserves."
        ]
    },
    Greed: {
        prompt: "What desire for more now drives you?",
        examples: [
            "I have gone without too long to settle for little.",
            "Enough is a lie told by those who already have plenty.",
            "If there is more to gain, I intend to take it."
        ]
    },
    Guilt: {
        prompt: "What wrong now follows you and demands answer?",
        examples: [
            "What I failed to prevent still belongs to me.",
            "I owe more to the dead than memory alone.",
            "I cannot move forward honestly without reckoning first."
        ]
    },
    Hardness: {
        prompt: "What pain taught you to toughen your heart?",
        examples: [
            "Softness costs too much when the world turns cruel.",
            "I keep myself hard enough to survive the next blow.",
            "Kindness without strength is too easily crushed."
        ]
    },
    Honor: {
        prompt: "What principle of conduct now defines you?",
        examples: [
            "I keep faith even when it is costly.",
            "A worthy name is earned by worthy deeds.",
            "I do not take the easy shameful path."
        ]
    },
    Hope: {
        prompt: "What better outcome do you refuse to stop believing in?",
        examples: [
            "Things can still be mended, and I will act as if that is true.",
            "I carry a better future in stubborn faith.",
            "Despair is not the only honest answer."
        ]
    },
    Humiliation: {
        prompt: "What shame now burns strongly enough to shape you?",
        examples: [
            "I will never stand exposed and helpless like that again.",
            "What shamed me also sharpened me.",
            "I remember every laugh that was not kind."
        ]
    },
    Humility: {
        prompt: "What has taught you your proper limits?",
        examples: [
            "I know how small one life can be against the world.",
            "Pride blinds faster than weakness does.",
            "I would rather learn than posture."
        ]
    },
    Independence: {
        prompt: "What made self-direction essential to you?",
        examples: [
            "I choose my own path, even when it is harder.",
            "I do not belong under another's hand.",
            "Dependence is too dangerous to accept lightly."
        ]
    },
    Instinct: {
        prompt: "What inner signal have you learned to trust?",
        examples: [
            "My gut has kept me alive when reason lagged behind.",
            "I move when the body knows before the mind can explain.",
            "There is wisdom in the warning I feel first."
        ]
    },
    Integrity: {
        prompt: "What truth of character do you refuse to betray?",
        examples: [
            "If I lose my honesty, I lose the best part of myself.",
            "I must be able to trust the person I am becoming.",
            "What I claim to value must show in what I do."
        ]
    },
    Legacy: {
        prompt: "What do you want your life to leave behind?",
        examples: [
            "I will leave a name that endures.",
            "My deeds must outlast my years.",
            "I mean to build something that cannot be ignored."
        ]
    },
    Leverage: {
        prompt: "What taught you that influence matters more than innocence?",
        examples: [
            "I keep what gives me advantage.",
            "Information is power only if you know when to use it.",
            "I would rather hold a useful debt than a clean conscience."
        ]
    },
    Loyalty: {
        prompt: "Who or what has earned your steadfastness?",
        examples: [
            "I do not abandon those who stood with me.",
            "My word binds me longer than convenience does.",
            "When I give my loyalty, I mean it."
        ]
    },
    Mastery: {
        prompt: "What craft, discipline, or self-command do you mean to perfect?",
        examples: [
            "I will not remain merely competent.",
            "Skill deserves devotion until it becomes second nature.",
            "I intend to become undeniable at what I do."
        ]
    },
    Mercy: {
        prompt: "What suffering taught you to spare others when you can?",
        examples: [
            "Power means little if it cannot choose restraint.",
            "I remember what kindness cost, and I honor it by giving it.",
            "Not every enemy must be broken to be defeated."
        ]
    },
    Mistrust: {
        prompt: "What lesson made trust difficult?",
        examples: [
            "Promises are masks until proven otherwise.",
            "I rely on myself before I rely on anyone.",
            "Trust is earned slowly and lost at once."
        ]
    },
    Nerve: {
        prompt: "What has taught you to keep your edge under pressure?",
        examples: [
            "I hold steady when others hesitate.",
            "A cool nerve wins where panic loses.",
            "I trust myself most when the stakes are highest."
        ]
    },
    Numbness: {
        prompt: "What has gone quiet inside you after all this?",
        examples: [
            "There are things in me that no longer wake easily.",
            "Feeling less is sometimes the only way through.",
            "I move because I must, not because I still burn the way I once did."
        ]
    },
    Obedience: {
        prompt: "What order, authority, or structure do you now submit to?",
        examples: [
            "I do my part best when I know the line I must hold.",
            "Disorder ruins more lives than discipline does.",
            "There is safety in knowing whom to follow."
        ]
    },
    Obsession: {
        prompt: "What pursuit has begun to crowd out everything else?",
        examples: [
            "I cannot let this matter rest unfinished.",
            "Some answers refuse to leave me in peace.",
            "What grips me now is stronger than convenience or sleep."
        ]
    },
    Opportunism: {
        prompt: "What taught you to seize openings before they vanish?",
        examples: [
            "I take the chance that appears, because chances do not linger.",
            "A closed door is less useful than a half-open one.",
            "If fortune blinks, I move before it looks away."
        ]
    },
    Order: {
        prompt: "What structure or rule now feels necessary to you?",
        examples: [
            "Things hold together only if someone keeps them in line.",
            "Order protects the weak from chaos.",
            "I trust a measured rule more than a passionate impulse."
        ]
    },
    Paranoia: {
        prompt: "What hidden threat do you now expect as a matter of course?",
        examples: [
            "Safety is what people talk about just before betrayal arrives.",
            "I look twice because once is how you get caught.",
            "Someone is always watching for a weakness."
        ]
    },
    Patience: {
        prompt: "What has taught you to wait for the right hour?",
        examples: [
            "Good timing matters more than quick movement.",
            "I can wait longer than most people can keep pretending.",
            "Some victories belong to the one who does not rush."
        ]
    },
    Perfectionism: {
        prompt: "What in you refuses to tolerate flawed work or weak effort?",
        examples: [
            "If it is worth doing, it is worth doing cleanly.",
            "Carelessness leaves scars that discipline would have spared.",
            "I do not settle when excellence is possible."
        ]
    },
    Polish: {
        prompt: "What refinement or presentation now matters to you?",
        examples: [
            "How one appears changes what one is allowed to do.",
            "Rough truth often needs a polished face to survive.",
            "I mean to carry myself like someone the room must notice."
        ]
    },
    Practicality: {
        prompt: "What taught you to prefer what works over what sounds noble?",
        examples: [
            "Useful answers matter more than elegant ones.",
            "I trust what gets people through the day alive.",
            "Fine ideals mean little if they cannot bear weight."
        ]
    },
    Pragmatism: {
        prompt: "What result now matters more than purity of method?",
        examples: [
            "I judge choices by what they achieve.",
            "The world rarely rewards the beautifully useless answer.",
            "I would rather be effective than admired."
        ]
    },
    Precision: {
        prompt: "What has taught you that exactness matters?",
        examples: [
            "A single small error can undo everything.",
            "I do not trust sloppiness with important things.",
            "Care and exactness are forms of respect."
        ]
    },
    Pride: {
        prompt: "What worth in yourself do you now guard fiercely?",
        examples: [
            "I know what I am, and I will not live beneath it.",
            "I have earned the right to stand taller than shame would like.",
            "I will not let others define my value cheaply."
        ]
    },
    Prudence: {
        prompt: "What taught you to weigh danger before desire?",
        examples: [
            "I count the losses before I accept the gain.",
            "Desire can wait; consequences rarely do.",
            "The wiser choice is often the quieter one."
        ]
    },
    Repentance: {
        prompt: "What do you need to atone for or turn away from?",
        examples: [
            "I cannot remain what I was and still live honestly.",
            "Some debts are moral before they are material.",
            "I seek a way back from what I have done."
        ]
    },
    Resentment: {
        prompt: "What injustice still rankles and refuses to fade?",
        examples: [
            "I have not forgiven what was taken lightly from me.",
            "Their comfort was built too easily on my cost.",
            "Some injuries do not heal into wisdom; they harden into memory."
        ]
    },
    Resignation: {
        prompt: "What loss has taught you to expect less from the world?",
        examples: [
            "I have stopped asking for fairness from life.",
            "Some hopes are lighter when you set them down.",
            "I endure what comes, because outrage changes little."
        ]
    },
    Resilience: {
        prompt: "What has proven to you that you can bend without breaking?",
        examples: [
            "I recover because I must, and because I can.",
            "Setbacks do not end me; they shape me.",
            "I return from hard things altered but still standing."
        ]
    },
    Resolve: {
        prompt: "What decision in you has become unshakable?",
        examples: [
            "I have chosen my course, and I mean to keep it.",
            "Difficulty is no reason to turn aside.",
            "Once I commit, I do not let the road frighten me back."
        ]
    },
    Responsibility: {
        prompt: "Who or what do you now feel bound to carry?",
        examples: [
            "If no one else steps forward, I will.",
            "Others may depend on me, and I will not fail them.",
            "What is entrusted to me must be protected."
        ]
    },
    Restlessness: {
        prompt: "What in you refuses to stay settled or still?",
        examples: [
            "If I remain too long in one place, something in me starts to wither.",
            "Motion feels truer than comfort.",
            "There is always another road calling."
        ]
    },
    Restraint: {
        prompt: "What taught you the value of holding back?",
        examples: [
            "Not every impulse deserves a hand to carry it out.",
            "Strength is proved as much in what I refuse as in what I do.",
            "I keep tight rein on the parts of me that could do harm."
        ]
    },
    Revenge: {
        prompt: "What wrong do you mean to answer personally?",
        examples: [
            "I will settle the debt that justice left unpaid.",
            "What was done to me will not go unanswered.",
            "Some names deserve to hear mine again in fear."
        ]
    },
    Rigor: {
        prompt: "What strict standard do you now demand of yourself or others?",
        examples: [
            "Laxity breeds failure.",
            "I trust discipline more than inspiration.",
            "If something matters, it deserves exacting effort."
        ]
    },
    Secrecy: {
        prompt: "What must be hidden, protected, or withheld?",
        examples: [
            "Some truths are safer in silence.",
            "I reveal only what serves my purpose.",
            "What is mine to know is mine to guard."
        ]
    },
    Security: {
        prompt: "What safety or stability do you now mean to build?",
        examples: [
            "I want solid ground that cannot be taken in a single night.",
            "A guarded life is still a life worth making.",
            "I mean to make room where fear cannot reach so easily."
        ]
    },
    "Self-reliance": {
        prompt: "What taught you to depend first on yourself?",
        examples: [
            "I trust my own hands before any promise.",
            "If I stand, I stand because I made myself able to.",
            "Help is welcome, but never assumed."
        ]
    },
    Service: {
        prompt: "Whom do you now believe you exist to serve?",
        examples: [
            "A life is best measured by what it gives.",
            "I am most myself when I am useful to something beyond me.",
            "Service gives shape to what would otherwise drift."
        ]
    },
    Severity: {
        prompt: "What harshness in you now feels necessary?",
        examples: [
            "Soft handling fails certain kinds of danger.",
            "I do not confuse gentleness with wisdom in every case.",
            "There are times when firmness is the kinder truth."
        ]
    },
    Shame: {
        prompt: "What stain or failure still lives close under your skin?",
        examples: [
            "I live as if I still have something to make right.",
            "What shamed me now warns me where I must not fall again.",
            "I carry the memory of my own failure like a hidden scar."
        ]
    },
    Stature: {
        prompt: "What standing or dignity do you now seek to maintain?",
        examples: [
            "I mean to carry myself like someone of consequence.",
            "Status opens doors that talent alone cannot.",
            "I have learned that position shapes what a person may protect."
        ]
    },
    Steadiness: {
        prompt: "What taught you to value reliability over flash?",
        examples: [
            "I mean to be the one others can lean on.",
            "A steady hand matters when bright talent fails.",
            "I prefer constancy to spectacle."
        ]
    },
    Survival: {
        prompt: "What did hardship teach you to cling to?",
        examples: [
            "I will never be helpless again.",
            "I endure first and ask forgiveness later.",
            "If I must choose, I choose to live."
        ]
    },
    Thrift: {
        prompt: "What scarcity taught you to conserve and keep?",
        examples: [
            "Waste is an insult to lean years.",
            "I hold onto what others throw away too easily.",
            "Little things saved at the right time become safety later."
        ]
    },
    Unease: {
        prompt: "What lingering discomfort now keeps you from resting easy?",
        examples: [
            "Something is wrong more often than people admit.",
            "I listen to the feeling that says the surface is lying.",
            "Ease rarely lasts long enough to trust."
        ]
    },
    Vanity: {
        prompt: "What image of yourself now feels too important to ignore?",
        examples: [
            "How I am seen shapes what I can become.",
            "I do not pretend appearance is meaningless.",
            "I want admiration, and I am honest enough to admit it."
        ]
    },
    Vengeance: {
        prompt: "What wrong now deserves a colder, longer answer?",
        examples: [
            "I can wait a long time for the right reckoning.",
            "What was done will be paid back in full.",
            "I do not mistake time for forgiveness."
        ]
    },
    Vigilance: {
        prompt: "What danger taught you to remain watchful?",
        examples: [
            "I keep watch because disaster often arrives quietly.",
            "A careful eye prevents the second blow.",
            "I do not sleep easy while anything important remains exposed."
        ]
    },
    Wonder: {
        prompt: "What beauty or mystery now keeps your spirit open?",
        examples: [
            "There is more in the world than hardship, and I mean to find it.",
            "Wonder keeps me from becoming smaller than my suffering.",
            "I want to remain capable of astonishment."
        ]
    }
};

function getDriveHintData(category) {
    return DRIVE_HINTS[category] ?? {
        prompt: `What conviction does ${category} leave behind in you?`,
        examples: [
            "I carry this lesson into every difficult choice.",
            "What happened to me changed what I can accept.",
            "I mean to live according to what this awakened in me."
        ]
    };
}

function renderDriveHintHtml(category) {
    const hint = getDriveHintData(category);
    const safeCategory = foundry.utils.escapeHTML(category);
    const safePrompt = foundry.utils.escapeHTML(hint.prompt);
    const examples = hint.examples.map(example => `
      <li class="chargen-dialog__hint-example">"${foundry.utils.escapeHTML(example)}"</li>
    `).join("");
    return `
      <div class="chargen-dialog__hint">
        <div class="chargen-dialog__hint-title">Cause: ${safeCategory}</div>
        <p class="chargen-dialog__hint-copy">${safePrompt}</p>
        <ul class="chargen-dialog__hint-list">
          ${examples}
        </ul>
      </div>
    `;
}

export async function promptAddDrive(actor, category) {
    return new Promise(resolve => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        new Dialog({
            title: "Define a Drive",
            content: `
        <div class="chargen-dialog">
          <div class="chargen-dialog__eyebrow">Inner Life</div>
          <h2 class="chargen-dialog__title">Define a Drive</h2>
          <p class="chargen-dialog__copy"><strong>${foundry.utils.escapeHTML(category)}</strong> asks for a conviction that will pull at the character's choices.</p>
          ${renderDriveHintHtml(category)}
          <div class="chargen-dialog__field">
            <label for="drive-text">Drive</label>
            <textarea id="drive-text" rows="4" placeholder="Write a conviction that influences your actions."></textarea>
          </div>
        </div>
      `,
            buttons: {
                add: {
                    label: "Add Drive",
                    callback: async html => {
                        const text = html.find("#drive-text").val()?.trim();
                        if (!text) return finish(false);

                        const line = `[${category}] ${text}`;

                        const props = actor.system?.props ?? {};
                        const existing = String(props.Drives ?? "").trim();

                        const updated = existing ? `${existing}\n${line}` : line;

                        await actor.update({ "system.props.Drives": updated });
                        finish(true);
                    }
                },
                skip: {
                    label: "Skip",
                    callback: () => finish(false)
                }
            },
            default: "add",
            close: () => finish(false)
        }, { width: 560, classes: ["skilltree-chargen-dialog"] }).render(true);
    });
}


export async function promptRemoveDrive(actor) {
    const props = actor.system?.props ?? {};
    const raw = String(props.Drives ?? "").trim();
    if (!raw) return false;

    const lines = raw.split("\n").map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) return false;

    return new Promise(resolve => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        new Dialog({
            title: "Lose a Drive",
            content: `
        <div class="chargen-dialog">
          <div class="chargen-dialog__eyebrow">Inner Life</div>
          <h2 class="chargen-dialog__title">Lose a Drive</h2>
          <p class="chargen-dialog__copy">Choose which conviction is slipping away.</p>
          <form class="chargen-dialog__choice-list">
            ${lines.map((l, i) => `
              <label class="chargen-dialog__choice">
                <input type="radio" name="drive" value="${i}" ${i === 0 ? "checked" : ""}>
                <span class="chargen-dialog__choice-body">
                  <span class="chargen-dialog__choice-mark"></span>
                  <span>
                    <span class="chargen-dialog__choice-title">${foundry.utils.escapeHTML(l)}</span>
                    <span class="chargen-dialog__choice-meta">Remove this drive from the character.</span>
                  </span>
                </span>
              </label>
            `).join("")}
          </form>
        </div>
      `,
            buttons: {
                remove: {
                    label: "Remove Drive",
                    callback: async html => {
                        const idxStr = html.find("input[name=drive]:checked").val();
                        if (idxStr === undefined) return finish(false);

                        const idx = Number(idxStr);
                        const updatedLines = lines.filter((_, i) => i !== idx);
                        const updated = updatedLines.join("\n");

                        await actor.update({ "system.props.Drives": updated });
                        finish(true);
                    }
                },
                cancel: {
                    label: "Keep All",
                    callback: () => finish(false)
                }
            },
            default: "remove",
            close: () => finish(false)
        }, { width: 600, classes: ["skilltree-chargen-dialog"] }).render(true);
    });
}
